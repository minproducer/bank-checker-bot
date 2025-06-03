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
        question: `🔐 *CAPTCHA VERIFICATION*\n\n🧮 Vui lòng giải phép tính sau:\n\`${a} + ${b} = ?\`\n\n⏰ _Có hiệu lực trong 10 phút_`,
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

// Hàm format kết quả đẹp
function formatBankResult(result, accountNumber) {
    if (!result || result.length === 0) {
        return `❌ *KHÔNG TÌM THẤY THÔNG TIN*\n\n🔢 Số tài khoản: \`${accountNumber}\`\n\n_Vui lòng kiểm tra lại số tài khoản_`;
    }

    if (result[0].includes('❌')) {
        return `⚠️ *LỖI XẢY RA*\n\n🔢 Số tài khoản: \`${accountNumber}\`\n\n${result[0]}\n\n_Vui lòng thử lại sau ít phút_`;
    }

    let formatted = `✅ *THÔNG TIN TÀI KHOẢN*\n\n`;
    formatted += `🔢 *Số tài khoản:* \`${accountNumber}\`\n`;

    // Tên chủ tài khoản
    if (result[0]) {
        const name = result[0].replace('✅ ', '');
        formatted += `👤 *Chủ tài khoản:* \`${name}\`\n\n`;
    }

    // Danh sách ngân hàng
    if (result.length > 1) {
        formatted += `🏦 *Ngân hàng hỗ trợ:*\n`;
        for (let i = 1; i < result.length; i++) {
            if (result[i].trim()) {
                formatted += `• ${result[i]}\n`;
            }
        }
    }

    formatted += `\n⏰ _Kiểm tra lúc: ${new Date().toLocaleString('vi-VN')}_`;
    return formatted;
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
    return ctx?.request?.ip || 'unknown';
}

// Bot logic
bot.start((ctx) => {
    const welcomeMsg = `🏦 *BANK ACCOUNT CHECKER*\n\n` +
        `👋 Chào mừng bạn đến với bot kiểm tra tài khoản ngân hàng!\n\n` +
        `📝 *Cách sử dụng:*\n` +
        `• Gửi số tài khoản ngân hàng (9-14 chữ số)\n` +
        `• Bot sẽ trả về tên chủ tài khoản và ngân hàng\n\n` +
        `⚡ *Giới hạn:* 10 lượt kiểm tra/ngày\n\n` +
        `🔧 *Lệnh hỗ trợ:*\n` +
        `• /checklimit - Xem số lượt còn lại\n` +
        `• /help - Hướng dẫn chi tiết\n\n` +
        `_Hãy gửi số tài khoản để bắt đầu!_`;

    ctx.reply(welcomeMsg, { parse_mode: 'Markdown' });
});

bot.command('help', (ctx) => {
    const helpMsg = `📖 *HƯỚNG DẪN SỬ DỤNG*\n\n` +
        `🔍 *Kiểm tra tài khoản:*\n` +
        `• Gửi số tài khoản từ 9-14 chữ số\n` +
        `• Ví dụ: \`1234567890\`\n\n` +
        `📊 *Giới hạn sử dụng:*\n` +
        `• Mỗi user: 10 lượt/ngày\n` +
        `• Mỗi IP: 20 lượt/ngày\n\n` +
        `🔐 *Bảo mật:*\n` +
        `• Khi vượt giới hạn, cần xác thực Captcha\n` +
        `• Dữ liệu không được lưu trữ lâu dài\n\n` +
        `⚡ *Lệnh hữu ích:*\n` +
        `• /checklimit - Xem lượt còn lại\n` +
        `• /start - Khởi động lại bot\n\n` +
        `❓ *Cần hỗ trợ?* Liên hệ admin.`;

    ctx.reply(helpMsg, { parse_mode: 'Markdown' });
});

bot.hears(/^[0-9]{9,14}$/, async (ctx) => {
    const userId = ctx.from.id.toString();
    const ip = getIP(ctx);
    const acc = ctx.message.text;

    // Nếu user đang có Captcha chờ xác thực
    if (await hasPendingCaptcha(userId)) {
        const pendingMsg = `🚫 *CAPTCHA ĐANG CHỜ XÁC THỰC*\n\n` +
            `⚠️ Bạn cần trả lời Captcha trước khi tiếp tục kiểm tra tài khoản.\n\n` +
            `_Vui lòng nhập đáp án của phép tính đã gửi trước đó._`;
        ctx.reply(pendingMsg, { parse_mode: 'Markdown' });
        return;
    }

    // Chống spam IP
    if (!(await canCheckIP(ip))) {
        const question = await setUserCaptcha(userId);
        const ipLimitMsg = `🚨 *GIỚI HẠN IP*\n\n` +
            `⛔ IP của bạn đã vượt quá 20 lần kiểm tra trong ngày.\n\n` +
            question + `\n\n` +
            `💡 _Gửi đáp án để tiếp tục sử dụng dịch vụ._`;
        ctx.reply(ipLimitMsg, { parse_mode: 'Markdown' });
        return;
    }

    // Giới hạn lượt user
    if (!(await canCheckToday(userId))) {
        const question = await setUserCaptcha(userId);
        const userLimitMsg = `📊 *HẾT LƯỢT KIỂM TRA*\n\n` +
            `⏰ Bạn đã sử dụng hết 10 lượt kiểm tra trong ngày.\n\n` +
            question + `\n\n` +
            `🔄 _Lượt kiểm tra sẽ được reset vào 00:00 hàng ngày._`;
        ctx.reply(userLimitMsg, { parse_mode: 'Markdown' });
        return;
    }

    // Thông báo đang xử lý
    ctx.replyWithChatAction('typing');
    const processingMsg = `🔍 *ĐANG KIỂM TRA...*\n\n` +
        `🔢 Số tài khoản: \`${acc}\`\n\n` +
        `⏳ _Vui lòng đợi trong giây lát..._`;
    const processingMessage = await ctx.reply(processingMsg, { parse_mode: 'Markdown' });

    // Thực hiện kiểm tra
    const result = await checkBankAccount(acc);
    const formattedResult = formatBankResult(result, acc);

    // Xóa thông báo đang xử lý và gửi kết quả
    try {
        await ctx.deleteMessage(processingMessage.message_id);
    } catch (e) { }

    await ctx.reply(formattedResult, { parse_mode: 'Markdown' });

    // Ghi nhận lượt check và hiển thị lượt còn lại
    await recordCheck(userId);
    await recordCheckIP(ip);

    const remaining = await remainingChecks(userId);
    const remainingMsg = `📈 *Bạn còn ${remaining}/10 lượt kiểm tra hôm nay*`;
    setTimeout(() => {
        ctx.reply(remainingMsg, { parse_mode: 'Markdown' });
    }, 1000);
});

bot.on('text', async (ctx) => {
    const userId = ctx.from.id.toString();
    if (await hasPendingCaptcha(userId)) {
        const ok = await checkUserCaptcha(userId, ctx.message.text);
        if (ok) {
            const successMsg = `✅ *CAPTCHA THÀNH CÔNG*\n\n` +
                `🎉 Xác thực hoàn tất! Bạn có thể tiếp tục kiểm tra tài khoản.\n\n` +
                `_Hãy gửi số tài khoản để bắt đầu._`;
            ctx.reply(successMsg, { parse_mode: 'Markdown' });
        } else {
            const failMsg = `❌ *CAPTCHA THẤT BẠI*\n\n` +
                `⚠️ Đáp án không chính xác hoặc đã hết hạn.\n\n` +
                `🔄 _Gửi lại số tài khoản để nhận Captcha mới._`;
            ctx.reply(failMsg, { parse_mode: 'Markdown' });
        }
    } else {
        const invalidMsg = `❓ *LỆNH KHÔNG HỢP LỆ*\n\n` +
            `📝 Vui lòng gửi số tài khoản ngân hàng (9-14 chữ số)\n\n` +
            `💡 _Hoặc sử dụng /help để xem hướng dẫn._`;
        ctx.reply(invalidMsg, { parse_mode: 'Markdown' });
    }
});

bot.command('checklimit', async (ctx) => {
    const left = await remainingChecks(ctx.from.id.toString());
    const today = new Date().toLocaleDateString('vi-VN');

    const limitMsg = `📊 *THỐNG KÊ SỬ DỤNG*\n\n` +
        `📅 Ngày: ${today}\n` +
        `🔢 Lượt còn lại: *${left}/10*\n\n` +
        `${left > 5 ? '🟢' : left > 2 ? '🟡' : '🔴'} _${left > 5 ? 'Còn nhiều lượt' : left > 0 ? 'Sắp hết lượt' : 'Đã hết lượt'}_\n\n` +
        `🔄 _Reset vào 00:00 hàng ngày_`;

    ctx.reply(limitMsg, { parse_mode: 'Markdown' });
});

// Stats cho admin
bot.command('stats', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;

    await db.read();
    const users = Object.keys(db.data.users).length;
    let totalChecks = 0;
    let todayChecks = 0;
    const today = new Date().toISOString().slice(0, 10);

    for (const user of Object.values(db.data.users)) {
        for (const [date, count] of Object.entries(user.checks)) {
            totalChecks += count;
            if (date === today) todayChecks += count;
        }
    }

    const statsMsg = `📈 *THỐNG KÊ HỆ THỐNG*\n\n` +
        `👥 Tổng số user: *${users}*\n` +
        `🔢 Tổng lượt check: *${totalChecks}*\n` +
        `📅 Hôm nay: *${todayChecks}*\n\n` +
        `⏰ _Cập nhật: ${new Date().toLocaleString('vi-VN')}_`;

    ctx.reply(statsMsg, { parse_mode: 'Markdown' });
});

// Đăng ký webhook và route xử lý
bot.telegram.setWebhook(`${process.env.WEBHOOK_URL}/telegram`);
app.use(bot.webhookCallback('/telegram'));

app.get('/', (req, res) => {
    res.send(`
    <h1>🏦 Bank Account Checker Bot</h1>
    <p>✅ Bot is running successfully!</p>
    <p>📊 Status: Active</p>
    <p>⏰ Last check: ${new Date().toLocaleString('vi-VN')}</p>
  `);
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
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

// Xử lý lỗi chung
bot.catch((err, ctx) => {
    console.error('Bot error:', err);
    const errorMsg = `⚠️ *LỖI HỆ THỐNG*\n\n` +
        `🔧 Bot đang gặp sự cố tạm thời.\n\n` +
        `_Vui lòng thử lại sau ít phút._`;
    ctx.reply(errorMsg, { parse_mode: 'Markdown' }).catch(() => { });
});
