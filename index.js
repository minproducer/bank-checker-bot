// server.js
require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const puppeteer = require('puppeteer');
const crypto = require('crypto');
const fs = require('fs');
const app = express();

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = process.env.ADMIN_ID;

let db, captchaDb, ipDb, fetch;

// FIX: Sửa lỗi import JSONFile
async function initDB() {
    const { Low } = await import('lowdb');
    const { JSONFile } = await import('lowdb/node');
    fetch = (await import('node-fetch')).default;

    db = new Low(new JSONFile('./history.json'), {});
    captchaDb = new Low(new JSONFile('./captcha.json'), {});
    ipDb = new Low(new JSONFile('./ip.json'), {});

    await db.read();
    db.data ||= { users: {} };

    await captchaDb.read();
    captchaDb.data ||= { captchas: {} };

    await ipDb.read();
    ipDb.data ||= { ips: {} };

    await db.write();
    await captchaDb.write();
    await ipDb.write();
}

let browser = null;
async function getBrowser() {
    if (!browser || !browser.isConnected()) {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
    }
    return browser;
}

function isAdmin(userId) {
    return userId.toString() === ADMIN_ID;
}

function generateCaptcha() {
    const a = Math.floor(Math.random() * 10) + 1;
    const b = Math.floor(Math.random() * 10) + 1;
    return {
        question: `🔐 *CAPTCHA VERIFICATION*\n\n🧮 Vui lòng giải phép tính sau:\n\`${a} + ${b} = ?\`\n\n⏰ _Có hiệu lực trong 10 phút_`,
        answer: (a + b).toString()
    };
}

async function canCheckToday(userId) {
    if (isAdmin(userId)) return true;

    await db.read();
    const today = new Date().toISOString().slice(0, 10);
    db.data.users[userId] ||= { checks: {} };
    db.data.users[userId].checks[today] ||= 0;
    await db.write();
    return db.data.users[userId].checks[today] < 10;
}

async function recordCheck(userId) {
    if (isAdmin(userId)) return;

    await db.read();
    const today = new Date().toISOString().slice(0, 10);
    db.data.users[userId] ||= { checks: {} };
    db.data.users[userId].checks[today] ||= 0;
    db.data.users[userId].checks[today]++;
    await db.write();
}

async function remainingChecks(userId) {
    if (isAdmin(userId)) return '∞';

    await db.read();
    const today = new Date().toISOString().slice(0, 10);
    if (!db.data.users[userId] || !db.data.users[userId].checks[today]) return 10;
    return 10 - db.data.users[userId].checks[today];
}

async function resetUserChecks(userId) {
    await db.read();
    const today = new Date().toISOString().slice(0, 10);
    if (db.data.users[userId] && db.data.users[userId].checks) {
        db.data.users[userId].checks[today] = 0;
    }
    await db.write();
}

async function canCheckIP(ip) {
    if (ip === 'unknown') return true;
    await ipDb.read();
    const today = new Date().toISOString().slice(0, 10);
    ipDb.data.ips[ip] ||= {};
    ipDb.data.ips[ip][today] ||= 0;
    await ipDb.write();
    return ipDb.data.ips[ip][today] < 20;
}

async function recordCheckIP(ip) {
    if (ip === 'unknown') return;
    await ipDb.read();
    const today = new Date().toISOString().slice(0, 10);
    ipDb.data.ips[ip][today]++;
    await ipDb.write();
}

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
    if (Date.now() - entry.timestamp > 10 * 60 * 1000) {
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

function formatBankResult(result, accountNumber) {
    if (!result || result.length === 0) {
        return `❌ *KHÔNG TÌM THẤY THÔNG TIN*\n\n🔢 Số tài khoản: \`${accountNumber}\`\n\n_Vui lòng kiểm tra lại số tài khoản_`;
    }

    if (result[0].includes('❌')) {
        return `⚠️ *LỖI XẢY RA*\n\n🔢 Số tài khoản: \`${accountNumber}\`\n\n${result[0]}\n\n_Vui lòng thử lại sau ít phút_`;
    }

    let formatted = `✅ *THÔNG TIN TÀI KHOẢN*\n\n`;
    formatted += `🔢 *Số tài khoản:* \`${accountNumber}\`\n`;

    if (result[0]) {
        const name = result[0].replace('✅ ', '');
        formatted += `👤 *Chủ tài khoản:* \`${name}\`\n\n`;
    }

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

async function checkBankAccount(accountNumber) {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
        console.log(`[${new Date().toISOString()}] Checking account: ${accountNumber}`);

        await page.goto('https://muabanpm.com', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        await page.waitForSelector('#input-from', { timeout: 15000 });
        await page.type('#input-from', accountNumber, { delay: 80 });
        await page.keyboard.press('Tab');

        await page.waitForFunction(
            () => {
                const el = document.querySelector('#addon-from');
                const text = el?.innerText?.trim();
                return text && text !== 'Loading...' && text.length > 3;
            },
            { timeout: 15000 }
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

        console.log(`[${new Date().toISOString()}] Account check success: ${accountNumber}`);
        await page.close();
        return result;
    } catch (err) {
        console.error(`[${new Date().toISOString()}] Account check error: ${accountNumber}`, err.message);
        await page.close();
        return [`❌ Lỗi: ${err.message}`];
    }
}

function getIP(ctx) {
    return ctx?.request?.ip ||
        ctx?.req?.ip ||
        ctx?.req?.connection?.remoteAddress ||
        ctx?.req?.socket?.remoteAddress ||
        (ctx?.req?.headers && ctx.req.headers['x-forwarded-for']) ||
        'unknown';
}

bot.start((ctx) => {
    const isAdminUser = isAdmin(ctx.from.id);
    const welcomeMsg = `🏦 *BANK ACCOUNT CHECKER*\n\n` +
        `👋 Chào mừng ${isAdminUser ? '**ADMIN**' : 'bạn'} đến với bot kiểm tra tài khoản ngân hàng!\n\n` +
        `📝 *Cách sử dụng:*\n` +
        `• Gửi số tài khoản ngân hàng (9-14 chữ số)\n` +
        `• Bot sẽ trả về tên chủ tài khoản và ngân hàng\n\n` +
        `⚡ *Giới hạn:* ${isAdminUser ? 'Unlimited ∞' : '10 lượt kiểm tra/ngày'}\n\n` +
        `🔧 *Lệnh hỗ trợ:*\n` +
        `• /checklimit - Xem số lượt còn lại\n` +
        `• /help - Hướng dẫn chi tiết\n` +
        (isAdminUser ? `• /stats - Thống kê hệ thống\n• /reset - Reset lượt user\n` : '') +
        `\n_Hãy gửi số tài khoản để bắt đầu!_`;

    ctx.reply(welcomeMsg, { parse_mode: 'Markdown' });
});

bot.command('help', (ctx) => {
    const isAdminUser = isAdmin(ctx.from.id);
    const helpMsg = `📖 *HƯỚNG DẪN SỬ DỤNG*\n\n` +
        `🔍 *Kiểm tra tài khoản:*\n` +
        `• Gửi số tài khoản từ 9-14 chữ số\n` +
        `• Ví dụ: \`1234567890\`\n\n` +
        `📊 *Giới hạn sử dụng:*\n` +
        `• Mỗi user: ${isAdminUser ? 'Unlimited ∞' : '10 lượt/ngày'}\n` +
        `• Mỗi IP: 20 lượt/ngày\n\n` +
        `🔐 *Bảo mật:*\n` +
        `• Khi vượt giới hạn, cần xác thực Captcha\n` +
        `• Dữ liệu không được lưu trữ lâu dài\n\n` +
        `⚡ *Lệnh hữu ích:*\n` +
        `• /checklimit - Xem lượt còn lại\n` +
        `• /start - Khởi động lại bot\n` +
        (isAdminUser ? `\n🔧 *Lệnh Admin:*\n• /stats - Thống kê hệ thống\n• /reset - Reset lượt user\n` : '') +
        `\n❓ *Cần hỗ trợ?* Liên hệ admin.`;

    ctx.reply(helpMsg, { parse_mode: 'Markdown' });
});

bot.command('reset', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        ctx.reply('🚫 *KHÔNG CÓ QUYỀN*\n\n_Chỉ admin mới có thể sử dụng lệnh này._', { parse_mode: 'Markdown' });
        return;
    }

    if (ctx.message.reply_to_message) {
        const targetUserId = ctx.message.reply_to_message.from.id.toString();
        await resetUserChecks(targetUserId);

        const resetReplyMsg = `✅ *RESET THÀNH CÔNG*\n\n` +
            `👤 User: ${ctx.message.reply_to_message.from.first_name}\n` +
            `🆔 ID: \`${targetUserId}\`\n` +
            `🔄 Đã khôi phục 10 lượt kiểm tra\n\n` +
            `_User có thể tiếp tục sử dụng bot._`;
        ctx.reply(resetReplyMsg, { parse_mode: 'Markdown' });
        return;
    }

    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        const resetHelpMsg = `🔧 *HƯỚNG DẪN RESET*\n\n` +
            `📝 *Cách sử dụng:*\n` +
            `• Reply tin nhắn user + \`/reset\`\n` +
            `• \`/reset 123456789\` - Reset theo User ID\n` +
            `• \`/reset all\` - Reset tất cả user\n\n` +
            `⚠️ _Lệnh này chỉ reset lượt kiểm tra trong ngày hiện tại._`;
        ctx.reply(resetHelpMsg, { parse_mode: 'Markdown' });
        return;
    }

    const target = args[1];

    if (target === 'all') {
        await db.read();
        const today = new Date().toISOString().slice(0, 10);
        let resetCount = 0;

        for (const userId in db.data.users) {
            if (db.data.users[userId].checks && db.data.users[userId].checks[today]) {
                db.data.users[userId].checks[today] = 0;
                resetCount++;
            }
        }

        await db.write();
        const resetAllMsg = `✅ *RESET THÀNH CÔNG*\n\n` +
            `🔄 Đã reset lượt kiểm tra cho *${resetCount}* user\n` +
            `📅 Ngày: ${new Date().toLocaleDateString('vi-VN')}\n\n` +
            `_Tất cả user đã được khôi phục 10 lượt kiểm tra._`;
        ctx.reply(resetAllMsg, { parse_mode: 'Markdown' });

    } else if (/^\d+$/.test(target)) {
        await resetUserChecks(target);
        const resetUserMsg = `✅ *RESET USER THÀNH CÔNG*\n\n` +
            `👤 User ID: \`${target}\`\n` +
            `🔄 Đã khôi phục 10 lượt kiểm tra\n` +
            `📅 Ngày: ${new Date().toLocaleDateString('vi-VN')}\n\n` +
            `_User có thể tiếp tục sử dụng bot._`;
        ctx.reply(resetUserMsg, { parse_mode: 'Markdown' });

    } else {
        ctx.reply('❌ *ĐỊNH DẠNG SAI*\n\n_Vui lòng sử dụng: /reset 123456789 hoặc /reset all_', { parse_mode: 'Markdown' });
    }
});

bot.hears(/^[0-9]{9,14}$/, async (ctx) => {
    const userId = ctx.from.id.toString();
    const ip = getIP(ctx);
    const acc = ctx.message.text;

    if (await hasPendingCaptcha(userId)) {
        const pendingMsg = `🚫 *CAPTCHA ĐANG CHỜ XÁC THỰC*\n\n` +
            `⚠️ Bạn cần trả lời Captcha trước khi tiếp tục kiểm tra tài khoản.\n\n` +
            `_Vui lòng nhập đáp án của phép tính đã gửi trước đó._`;
        ctx.reply(pendingMsg, { parse_mode: 'Markdown' });
        return;
    }

    if (!isAdmin(userId)) {
        if (!(await canCheckIP(ip))) {
            const question = await setUserCaptcha(userId);
            const ipLimitMsg = `🚨 *GIỚI HẠN IP*\n\n` +
                `⛔ IP của bạn đã vượt quá 20 lần kiểm tra trong ngày.\n\n` +
                question + `\n\n` +
                `💡 _Gửi đáp án để tiếp tục sử dụng dịch vụ._`;
            ctx.reply(ipLimitMsg, { parse_mode: 'Markdown' });
            return;
        }

        if (!(await canCheckToday(userId))) {
            const question = await setUserCaptcha(userId);
            const userLimitMsg = `📊 *HẾT LƯỢT KIỂM TRA*\n\n` +
                `⏰ Bạn đã sử dụng hết 10 lượt kiểm tra trong ngày.\n\n` +
                question + `\n\n` +
                `🔄 _Lượt kiểm tra sẽ được reset vào 00:00 hàng ngày._`;
            ctx.reply(userLimitMsg, { parse_mode: 'Markdown' });
            return;
        }
    }

    ctx.replyWithChatAction('typing');
    const processingMsg = `🔍 *ĐANG KIỂM TRA...*\n\n` +
        `🔢 Số tài khoản: \`${acc}\`\n\n` +
        `⏳ _Vui lòng đợi trong giây lát..._`;
    const processingMessage = await ctx.reply(processingMsg, { parse_mode: 'Markdown' });

    const result = await checkBankAccount(acc);
    const formattedResult = formatBankResult(result, acc);

    try {
        await ctx.deleteMessage(processingMessage.message_id);
    } catch (e) { }

    await ctx.reply(formattedResult, { parse_mode: 'Markdown' });

    await recordCheck(userId);
    if (!isAdmin(userId)) await recordCheckIP(ip);

    const remaining = await remainingChecks(userId);
    const remainingMsg = `📈 *Bạn còn ${remaining}${remaining === '∞' ? '' : '/10'} lượt kiểm tra hôm nay*`;
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
    const userId = ctx.from.id.toString();
    const left = await remainingChecks(userId);
    const today = new Date().toLocaleDateString('vi-VN');
    const isAdminUser = isAdmin(userId);

    const limitMsg = `📊 *THỐNG KÊ SỬ DỤNG*\n\n` +
        `📅 Ngày: ${today}\n` +
        `🔢 Lượt còn lại: *${left}${left === '∞' ? '' : '/10'}*\n` +
        `👤 Quyền: ${isAdminUser ? '**ADMIN** (Unlimited)' : 'User'}\n\n` +
        `${left === '∞' ? '♾️' : left > 5 ? '🟢' : left > 2 ? '🟡' : '🔴'} _${left === '∞' ? 'Không giới hạn' : left > 5 ? 'Còn nhiều lượt' : left > 0 ? 'Sắp hết lượt' : 'Đã hết lượt'}_\n\n` +
        `🔄 _Reset vào 00:00 hàng ngày_`;

    ctx.reply(limitMsg, { parse_mode: 'Markdown' });
});

bot.command('stats', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        ctx.reply('🚫 *KHÔNG CÓ QUYỀN*\n\n_Chỉ admin mới có thể xem thống kê._', { parse_mode: 'Markdown' });
        return;
    }

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
        `📅 Hôm nay: *${todayChecks}*\n` +
        `🔧 Admin: *${ctx.from.first_name}*\n\n` +
        `⏰ _Cập nhật: ${new Date().toLocaleString('vi-VN')}_`;

    ctx.reply(statsMsg, { parse_mode: 'Markdown' });
});

async function startBot() {
    await initDB();

    if (process.env.WEBHOOK_URL) {
        bot.telegram.setWebhook(`${process.env.WEBHOOK_URL}/telegram`);
        app.use(bot.webhookCallback('/telegram'));
    } else {
        bot.launch();
    }

    console.log('✅ Bot started successfully!');
}

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

process.on('SIGINT', async () => {
    if (browser) await browser.close();
    process.exit();
});

bot.catch((err, ctx) => {
    console.error('Bot error:', err);
    const errorMsg = `⚠️ *LỖI HỆ THỐNG*\n\n` +
        `🔧 Bot đang gặp sự cố tạm thời.\n\n` +
        `_Vui lòng thử lại sau ít phút._`;
    ctx.reply(errorMsg, { parse_mode: 'Markdown' }).catch(() => { });
});

startBot();
// Export the app for testing or other purposes
module.exports = app;