// server.js
require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const puppeteer = require('puppeteer');
const { Low, JSONFile } = require('lowdb');
const fetch = require('node-fetch');
const crypto = require('crypto');
const fs = require('fs');
const app = express();

const bot = new Telegraf(process.env.BOT_TOKEN);

const db = new Low(new JSONFile('./history.json'));
const captchaDb = new Low(new JSONFile('./captcha.json'));
const ipDb = new Low(new JSONFile('./ip.json'));

// Khởi tạo DB nếu chưa có
async function initDB() {
    await db.read(); db.data ||= { users: {} };
    await captchaDb.read(); captchaDb.data ||= { captchas: {} };
    await ipDb.read(); ipDb.data ||= { ips: {} };
    await db.write(); await captchaDb.write(); await ipDb.write();
}
initDB();

let browser = null;
async function getBrowser() {
    if (!browser || !browser.isConnected()) {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
    }
    return browser;
}

// Tạo Captcha đơn giản (biểu thức toán học)
function generateCaptcha() {
    const a = Math.floor(Math.random() * 10) + 1;
    const b = Math.floor(Math.random() * 10) + 1;
    return {
        question: `📢 Vui lòng trả lời: ${a} + ${b} = ?`,
        answer: (a + b).toString()
    };
}

// Kiểm tra và ghi nhận lượt check user
async function canCheckToday(userId) {
    await db.read();
    const today = new Date().toISOString().slice(0, 10);
    db.data.users[userId] ||= { checks: {} };
    db.data.users[userId].checks[today] ||= 0;
    await db.write();
    return db.data.users[userId].checks[today] < 10;
}

async function recordCheck(userId) {
    await db.read();
    const today = new Date().toISOString().slice(0, 10);
    db.data.users[userId].checks[today]++;
    await db.write();
}

async function remainingChecks(userId) {
    await db.read();
    const today = new Date().toISOString().slice(0, 10);
    if (!db.data.users[userId] || !db.data.users[userId].checks[today]) return 10;
    return 10 - db.data.users[userId].checks[today];
}

// Kiểm tra và ghi nhận lượt check IP
async function canCheckIP(ip) {
    await ipDb.read();
    const today = new Date().toISOString().slice(0, 10);
    ipDb.data.ips[ip] ||= {};
    ipDb.data.ips[ip][today] ||= 0;
    await ipDb.write();
    return ipDb.data.ips[ip][today] < 20;
}

async function recordCheckIP(ip) {
    await ipDb.read();
    const today = new Date().toISOString().slice(0, 10);
    ipDb.data.ips[ip][today]++;
    await ipDb.write();
}

// Captcha cho user
async function setUserCaptcha(userId) {
    const { question, answer } = generateCaptcha();
    await captchaDb.read();
    captchaDb.data.captchas[userId] = { answer, timestamp: Date.now() };
    await captchaDb.write();
    return question;
}

async function checkUserCaptcha(userId, text) {
    await captchaDb.read();
    const entry = captchaDb.data.captchas[userId];
    if (!entry) return false;
    if (Date.now() - entry.timestamp > 10 * 60 * 1000) { // 10 phút hết hạn
        delete captchaDb.data.captchas[userId];
        await captchaDb.write();
        return false;
    }
    if (entry.answer === text.trim()) {
        delete captchaDb.data.captchas[userId];
        await captchaDb.write();
        return true;
    }
    return false;
}

async function hasPendingCaptcha(userId) {
    await captchaDb.read();
    return !!captchaDb.data.captchas[userId];
}

// Hàm kiểm tra tài khoản ngân hàng
async function checkBankAccount(accountNumber) {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
        await page.goto('https://muabanpm.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForSelector('#input-from', { timeout: 10000 });
        await page.type('#input-from', accountNumber, { delay: 80 });
        await page.keyboard.press('Tab');
        await page.waitForFunction(
            () => {
                const el = document.querySelector('#addon-from');
                const text = el?.innerText?.trim();
                return text && text !== 'Loading...' && text.length > 3;
            },
            { timeout: 10000 }
        );
        const result = await page.evaluate(() => {
            const data = [];
            const name = document.querySelector('#addon-from')?.innerText.trim();
            if (!name || name.toLowerCase().includes('loading')) return ['Không tìm thấy tên tài khoản'];
            data.push('✅ ' + name);
            document.querySelectorAll('#pay-from .pay')?.forEach(el => {
                const text = el.textContent?.trim();
                if (text) data.push(text);
            });
            return data;
        });
        await page.close();
        return result;
    } catch (err) {
        await page.close();
        return [`❌ Lỗi: ${err.message}`];
    }
}

// Lấy IP từ Telegram webhook (nếu có)
function getIP(ctx) {
    // Nếu dùng webhook, ctx.update.message.from.id là user, ctx.request.ip là IP
    return ctx?.request?.ip || 'unknown';
}

// Bot logic
bot.start((ctx) => ctx.reply('Gửi số tài khoản ngân hàng để kiểm tra tên người nhận.'));

bot.hears(/^[0-9]{9,14}$/, async (ctx) => {
    const userId = ctx.from.id.toString();
    const ip = ctx?.update?.message?.via_bot ? 'unknown' : (ctx?.ip || ctx?.request?.ip || 'unknown');
    const acc = ctx.message.text;

    // Nếu user đang có Captcha chờ xác thực
    if (await hasPendingCaptcha(userId)) {
        ctx.reply('🚫 Bạn cần trả lời Captcha trước khi tiếp tục.');
        return;
    }

    // Chống spam IP
    if (!(await canCheckIP(ip))) {
        const question = await setUserCaptcha(userId);
        ctx.reply('🔒 IP của bạn đã vượt quá giới hạn 20 lần/ngày.\n' + question + '\nGửi đáp án để tiếp tục.');
        return;
    }

    // Giới hạn lượt user
    if (!(await canCheckToday(userId))) {
        const question = await setUserCaptcha(userId);
        ctx.reply('🚫 Bạn đã hết 10 lượt kiểm tra hôm nay.\n' + question + '\nGửi đáp án để tiếp tục.');
        return;
    }

    ctx.replyWithChatAction('typing');
    const result = await checkBankAccount(acc);
    await ctx.reply(result.join('\n\n'));
    await recordCheck(userId);
    await recordCheckIP(ip);
});

bot.on('text', async (ctx) => {
    const userId = ctx.from.id.toString();
    if (await hasPendingCaptcha(userId)) {
        const ok = await checkUserCaptcha(userId, ctx.message.text);
        if (ok) {
            ctx.reply('✅ Xác thực Captcha thành công! Bạn có thể kiểm tra tiếp.');
        } else {
            ctx.reply('❌ Captcha sai hoặc đã hết hạn. Gửi lại số tài khoản hoặc /start để nhận Captcha mới.');
        }
    }
});

bot.command('checklimit', async (ctx) => {
    const left = await remainingChecks(ctx.from.id.toString());
    ctx.reply(`🔢 Bạn còn ${left} lượt kiểm tra trong hôm nay.`);
});

// Đăng ký webhook và route xử lý
bot.telegram.setWebhook(`${process.env.WEBHOOK_URL}/telegram`);
app.use(bot.webhookCallback('/telegram'));

app.get('/', (req, res) => {
    res.send('Bot is running.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server is running on port ${PORT}`);
});

// Đảm bảo đóng browser khi tắt server
process.on('SIGINT', async () => {
    if (browser) await browser.close();
    process.exit();
});
