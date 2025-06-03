// server.js
require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const puppeteer = require('puppeteer');
const fs = require('fs');

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const historyFile = './history.json';

// Tạo file lịch sử nếu chưa có
if (!fs.existsSync(historyFile)) fs.writeFileSync(historyFile, '{}');

const loadHistory = () => JSON.parse(fs.readFileSync(historyFile));
const saveHistory = (history) => fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));

async function checkBankAccount(accountNumber) {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.goto('https://muabanpm.com');
        await page.waitForSelector('#input-from');
        await page.type('#input-from', accountNumber);
        await page.click('body'); // click ra ngoài để trigger
        await page.waitForTimeout(3000);

        const result = await page.evaluate(() => {
            const data = [];
            const name = document.querySelector('#addon-from')?.textContent.trim();
            if (!name || name.toLowerCase().includes('loading')) return ['Không tìm thấy tên tài khoản'];
            data.push('✅ ' + name);
            document.querySelectorAll('#pay-from div')?.forEach(el => {
                const text = el.textContent?.trim();
                if (text) data.push(text);
            });
            return data;
        });

        await browser.close();
        return result;
    } catch (err) {
        await browser.close();
        return [`❌ Lỗi: ${err.message}`];
    }
}

function canCheckToday(userId) {
    const history = loadHistory();
    const today = new Date().toISOString().split('T')[0];
    if (!history[userId]) history[userId] = {};
    if (!history[userId][today]) history[userId][today] = 0;
    return history[userId][today] < 10;
}

function recordCheck(userId) {
    const history = loadHistory();
    const today = new Date().toISOString().split('T')[0];
    if (!history[userId]) history[userId] = {};
    if (!history[userId][today]) history[userId][today] = 0;
    history[userId][today]++;
    saveHistory(history);
}

function remainingChecks(userId) {
    const history = loadHistory();
    const today = new Date().toISOString().split('T')[0];
    if (!history[userId] || !history[userId][today]) return 10;
    return 10 - history[userId][today];
}

bot.start((ctx) => ctx.reply('Gửi số tài khoản ngân hàng để kiểm tra tên người nhận.'));
bot.hears(/^\d{9,14}$/, async (ctx) => {
    const userId = ctx.from.id;
    const acc = ctx.message.text;
    if (!canCheckToday(userId)) {
        ctx.reply('🚫 Bạn đã vượt quá 10 lần kiểm tra hôm nay.');
        return;
    }
    ctx.reply('🔍 Đang kiểm tra số tài khoản...');
    const result = await checkBankAccount(acc);
    result.forEach(line => ctx.reply(line));
    recordCheck(userId);
});

bot.command('checklimit', (ctx) => {
    const left = remainingChecks(ctx.from.id);
    ctx.reply(`🔢 Bạn còn ${left} lượt kiểm tra trong hôm nay.`);
});

app.use(bot.webhookCallback('/telegram'));
// bot.telegram.setWebhook(`${process.env.WEBHOOK_URL}/telegram`);
app.use(bot.webhookCallback('/telegram'));
// Đặt webhook cho bot
app.get('/', (req, res) => {
    res.send('Bot is running.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server is running on port ${PORT}`);
});

// 👇 KHỞI ĐỘNG BOT BẰNG POLLING (TẠM THỜI)
bot.launch();
console.log('🤖 Bot is running via polling...');
// server.js
// app.get('/', (req, res) => {
//     res.send('Bot is running.');
// });

// const PORT = process.env.PORT || 3000;
// app.listen(PORT, () => {
//     console.log(`✅ Server is running on port ${PORT}`);
// });
