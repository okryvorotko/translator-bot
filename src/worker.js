const TELEGRAM_API = "https://api.telegram.org";
const GOOGLE_TRANSLATE_API = "https://translation.googleapis.com/language/translate/v2";
const MAX_TELEGRAM_MESSAGE_LENGTH = 4096;
const GOOGLE_TRANSLATION_SCOPE = "https://www.googleapis.com/auth/cloud-translation";
let cachedGoogleAccessToken;

export default {
  async fetch(request, env) {
    if (request.method === "GET") {
      return Response.json({ ok: true, service: "telegram-translator-bot" });
    }
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const configurationError = validateEnvironment(env);
    if (configurationError) {
      console.error(configurationError);
      return new Response("Worker is not configured", { status: 500 });
    }

    if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    let update;
    try {
      update = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    try {
      await handleUpdate(update, env);
      return new Response("OK");
    } catch (error) {
      console.error("Failed to process Telegram update", {
        updateId: update?.update_id,
        error: error instanceof Error ? error.message : String(error),
      });
      return new Response("Failed to process update", { status: 500 });
    }
  },
};

export async function handleUpdate(update, env) {
  const message = update.message ?? update.edited_message;
  if (!message?.text || message.from?.is_bot) return;

  if (message.text === "/start" || message.text === "/help") {
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      message.chat.id,
      "Send a message in Thai or English. I will reply with its translation.",
      message.message_id,
    );
    return;
  }

  const targetLanguage = containsThai(message.text) ? "en" : "th";
  const translation = await translateText(message.text, targetLanguage, env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_BASE64);
  const chunks = splitMessage(`${update.edited_message ? "Edited: " : ""}${translation}`);

  for (let index = 0; index < chunks.length; index += 1) {
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      message.chat.id,
      chunks[index],
      index === 0 ? message.message_id : undefined,
    );
  }
}

export function containsThai(text) {
  return /[\u0E00-\u0E7F]/u.test(text);
}

export function splitMessage(text, maximumLength = MAX_TELEGRAM_MESSAGE_LENGTH) {
  const characters = Array.from(text);
  const chunks = [];
  for (let index = 0; index < characters.length; index += maximumLength) {
    chunks.push(characters.slice(index, index + maximumLength).join(""));
  }
  return chunks.length ? chunks : [""];
}

async function translateText(text, targetLanguage, encodedCredentials) {
  const accessToken = await getGoogleAccessToken(encodedCredentials);
  const response = await fetch(GOOGLE_TRANSLATE_API, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: text, target: targetLanguage, format: "text" }),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(`Google Translation API returned ${response.status}: ${result?.error?.message ?? "unknown error"}`);
  }
  const translatedText = result?.data?.translations?.[0]?.translatedText;
  if (typeof translatedText !== "string") throw new Error("Google Translation API returned no translated text");
  return decodeHtmlEntities(translatedText);
}

async function getGoogleAccessToken(encodedCredentials) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedGoogleAccessToken?.expiresAt > now + 60) return cachedGoogleAccessToken.value;

  let credentials;
  try {
    credentials = JSON.parse(decodeBase64Utf8(encodedCredentials));
  } catch {
    throw new Error("Google service-account credentials are not valid base64-encoded JSON");
  }
  if (!credentials.client_email || !credentials.private_key || !credentials.token_uri) {
    throw new Error("Google service-account credentials are missing required fields");
  }

  const header = encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = encodeBase64Url(JSON.stringify({
    iss: credentials.client_email,
    scope: GOOGLE_TRANSLATION_SCOPE,
    aud: credentials.token_uri,
    iat: now,
    exp: now + 3600,
  }));
  const unsignedJwt = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(credentials.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsignedJwt),
  );
  const assertion = `${unsignedJwt}.${arrayBufferToBase64Url(signature)}`;

  const response = await fetch(credentials.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) {
    throw new Error(`Google OAuth returned ${response.status}: ${result?.error_description ?? result?.error ?? "unknown error"}`);
  }

  cachedGoogleAccessToken = {
    value: result.access_token,
    expiresAt: now + Number(result.expires_in ?? 3600),
  };
  return cachedGoogleAccessToken.value;
}

function decodeBase64Utf8(value) {
  const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64Url(value) {
  return arrayBufferToBase64Url(new TextEncoder().encode(value));
}

function arrayBufferToBase64Url(value) {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function pemToArrayBuffer(pem) {
  const base64 = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/gu, "");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)).buffer;
}

async function sendTelegramMessage(botToken, chatId, text, replyToMessageId) {
  const body = { chat_id: chatId, text };
  if (replyToMessageId !== undefined) {
    body.reply_parameters = { message_id: replyToMessageId, allow_sending_without_reply: true };
  }

  const response = await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    throw new Error(`Telegram API returned ${response.status}: ${result?.description ?? "unknown error"}`);
  }
}

function decodeHtmlEntities(text) {
  return text
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function validateEnvironment(env) {
  const missing = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_BASE64"]
    .filter((name) => !env[name]);
  return missing.length ? `Missing Worker secrets: ${missing.join(", ")}` : null;
}
