require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const {Translate} = require('@google-cloud/translate').v2;
const fs = require('fs');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
	polling: true, request: {
		agentOptions: {
			keepAlive: true,
			family: 4
		}
	}
});
const translate = new Translate();

console.log('Printing env variables:');
console.log(`TELEGRAM_BOT_TOKEN: ${process.env.TELEGRAM_BOT_TOKEN}`);
console.log(`GOOGLE_APPLICATION_CREDENTIALS: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`);

bot.on('polling_error', (msg) => {
	console.log(msg);
	process.exit(0);
});

async function translateMsg(msg, event) {
	fs.appendFile('app.log', `\n${new Date()}: ${event}: ${JSON.stringify(msg)}`, (e) => {
		if (e) console.log(e);
	});
	const chatId = msg.chat.id;
	const fromId = msg.from.id;
	const incomingMsg = msg.text;
	
	const [detection] = await translate.detect(incomingMsg);
	let targetLanguage = 'en';
	if (detection.language === 'en') {
		targetLanguage = 'th';
	}
	
	const [translatedMsg] = await translate.translate(incomingMsg, targetLanguage);
	const options = {
		reply_to_message_id: msg.message_id,
		reply_markup: {
			mention: 'all',
			except_ids: [fromId]
		}
	};
	
	return {chatId, translatedMsg, options};
}

bot.on('message', async (msg) => {
	if (!msg.text) return;
	
	try {
		const {chatId, translatedMsg, options} = await translateMsg(msg, 'Incoming message');
		
		bot.sendMessage(chatId, translatedMsg, options);
	} catch (e) {
		fs.appendFile('app.log', `\n${new Date()}: Error: ${JSON.stringify(e)}`, (e) => {
			if (e) console.log(e);
		});
	}
});

bot.on('edited_message', async (msg) => {
	if (!msg.text) return;
	
	try {
		const {chatId, translatedMsg, options} = await translateMsg(msg, 'Edited message');
		
		bot.sendMessage(chatId, `Edited: ${translatedMsg}`, options);
	} catch (e) {
		fs.appendFile('app.log', `\n${new Date()}: Error: ${JSON.stringify(e)}`, (e) => {
			if (e) console.log(e);
		});
	}
});
