# Telegram Thai-English translator

A Telegram bot deployed as a Cloudflare Worker. Messages containing Thai characters are translated to English; other text is translated to Thai. The translation is posted as a reply to the original message.

The Worker uses Telegram webhooks, so there is no always-running server and no EC2 instance to maintain.

## Prerequisites

- A Telegram bot token from [@BotFather](https://t.me/BotFather).
- A Cloudflare account with a `workers.dev` subdomain enabled.
- A Google Cloud project with billing enabled and the Cloud Translation API enabled.
- Node.js 22 or later for local development.

## 1. Prepare the existing Google service account

The existing credential belongs to project `translator-bot-422503` and service account `translator-bot@translator-bot-422503.iam.gserviceaccount.com`. Confirm that [Cloud Translation API](https://console.cloud.google.com/apis/library/translate.googleapis.com?project=translator-bot-422503) is enabled and that billing remains active for this project.

Do not copy the JSON file into this repository. Convert the entire file to one base64 line in PowerShell:

```powershell
$credentialPath = "$env:USERPROFILE\Downloads\Telegram Desktop\google-translator-api-credentials.json"
$credentialBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($credentialPath))
$credentialBase64 | Set-Clipboard
Remove-Variable credentialBase64
```

The clipboard value becomes the `GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_BASE64` secret. Encoding is not encryption; it merely allows the multiline JSON/private key to be stored reliably as one secret. Keep it private.

Google requires billing even when usage remains inside its monthly translation credit.

## 2. Create a webhook secret

Generate a random value containing only letters, numbers, `_`, and `-`:

```bash
openssl rand -hex 32
```

Use the same value as `TELEGRAM_WEBHOOK_SECRET` in Cloudflare/GitHub and when registering the webhook. This is separate from the bot token.

## 3. First deployment from a computer

```bash
npm install
npx wrangler login
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_BASE64
npx wrangler kv namespace create MESSAGE_MAPPINGS
npm test
npm run deploy
```

Copy the namespace ID printed by the KV command into the `MESSAGE_MAPPINGS`
entry in `wrangler.jsonc`, replacing `REPLACE_WITH_KV_NAMESPACE_ID` before deploying.

Wrangler prints a URL similar to:

```text
https://telegram-translator-bot.<your-subdomain>.workers.dev
```

Opening it should return a small JSON health response.

## 4. Register the Telegram webhook

Substitute the three placeholder values:

```bash
curl --request POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  --header "Content-Type: application/json" \
  --data '{"url":"https://telegram-translator-bot.<your-subdomain>.workers.dev","secret_token":"<WEBHOOK_SECRET>","allowed_updates":["message","edited_message"],"drop_pending_updates":true}'
```

Confirm the result (do not publish this output):

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
```

Once Telegram reports the correct URL and no error, send the bot a private message.

### Group chats

To translate every ordinary group message, make the bot a group administrator or disable Privacy Mode via **@BotFather → Bot Settings → Group Privacy**. Telegram may require removing and re-adding the bot after changing it.

## Automatic deployment with GitHub Actions

`.github/workflows/deploy.yml` tests and deploys pushes to `main` or `master`. It replaces the former EC2 SSH deployment.

In GitHub, open **Settings → Secrets and variables → Actions** and add these repository secrets:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID shown in the Cloudflare dashboard |
| `CLOUDFLARE_API_TOKEN` | Token with **Account / Workers Scripts / Edit** permission |
| `TELEGRAM_BOT_TOKEN` | Token supplied by BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Random webhook secret generated above |
| `GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_BASE64` | Base64 of the complete existing service-account JSON |

Create the Cloudflare token from **My Profile → API Tokens → Create Token → Custom token** and limit it to the relevant account. GitHub Actions copies the runtime secrets into Cloudflare; they are never placed in `wrangler.jsonc`.

Push the repository, or open **Actions → Deploy Cloudflare Worker → Run workflow**. The action obtains the deployed URL and registers it with Telegram automatically. Review the log and check `getWebhookInfo` afterward.

## Local development

Create an ignored `.dev.vars` file:

```dotenv
TELEGRAM_BOT_TOKEN=...
TELEGRAM_WEBHOOK_SECRET=...
GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_BASE64=...
```

Then run:

```bash
npm run dev
```

Telegram cannot call `localhost`. Use a Cloudflare Quick Tunnel or a deployed test bot for webhook testing. Telegram supports only one webhook per bot, so do not point the production bot at a development endpoint.

## Operations and troubleshooting

View production logs with `npx wrangler tail`.

- Worker `401`: Telegram's registered webhook secret does not match the Worker secret.
- Google `401`/`403`: the service-account key was disabled, Translation is not enabled, billing is disabled, or the service account lacks access.
- Private chat works but a group does not: check BotFather Privacy Mode or make the bot an administrator.
- Pending updates or a last webhook error: inspect `getWebhookInfo` and `wrangler tail`.
- When a message is edited, the Worker deletes its previous translated reply and posts a fresh translation. The source-to-translation mapping is retained in Workers KV for 30 days. Telegram may refuse deletion of messages older than its permitted deletion window.

## Removing or replacing the deployment

Before returning to a polling bot, remove the webhook:

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/deleteWebhook?drop_pending_updates=true"
```

Then, if desired, delete the Worker with `npx wrangler delete`.
