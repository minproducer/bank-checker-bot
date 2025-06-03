// server.js
require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const puppeteer = require('puppeteer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const app = express();

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = process.env.ADMIN_ID;

let db, captchaDb, ipDb, fetch;

// Middleware để parse JSON
app.use(express.json());

// Tạo thư mục screenshots nếu chưa có
const screenshotDir = './screenshots';
if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir);
}

// FIX: Cải thiện khởi tạo database với error handling
async function initDB() {
    try {
        const { Low } = await import('lowdb');
        const { JSONFile } = await import('lowdb/node');
        fetch = (await import('node-fetch')).default;

        db = new Low(new JSONFile('./history.json'), { users: {} });
        captchaDb = new Low(new JSONFile('./captcha.json'), { captchas: {} });
        ipDb = new Low(new JSONFile('./ip.json'), { ips: {} });

        await db.read();
        await captchaDb.read();
        await ipDb.read();

        // FIX: Đảm bảo data structure luôn tồn tại
        db.data = db.data || { users: {} };
        captchaDb.data = captchaDb.data || { captchas: {} };
        ipDb.data = ipDb.data || { ips: {} };

        await db.write();
        await captchaDb.write();
        await ipDb.write();

        console.log('✅ Database initialized successfully');
    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        process.exit(1);
    }
}

let browser = null;
async function getBrowser() {
    if (!browser || !browser.isConnected()) {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run',
                '--no-zygote',
                '--single-process'
            ]
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

// Function chụp màn hình khi lỗi
async function captureErrorScreenshot(page, accountNumber, error) {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `error_${accountNumber}_${timestamp}.png`;
        const filepath = path.join(screenshotDir, filename);

        await page.screenshot({
            path: filepath,
            fullPage: true,
            type: 'png'
        });

        console.log(`📸 Screenshot saved: ${filepath}`);
        return filepath;
    } catch (screenshotError) {
        console.error('Failed to capture screenshot:', screenshotError);
        return null;
    }
}

// Function gửi screenshot cho admin
async function sendScreenshotToAdmin(screenshotPath, accountNumber, error) {
    if (!screenshotPath || !fs.existsSync(screenshotPath)) return;

    try {
        const caption = `🚨 *LỖI KIỂM TRA TÀI KHOẢN*\n\n` +
            `🔢 Số TK: \`${accountNumber}\`\n` +
            `❌ Lỗi: ${error}\n` +
            `⏰ Thời gian: ${new Date().toLocaleString('vi-VN')}`;

        await bot.telegram.sendPhoto(ADMIN_ID, {
            source: fs.createReadStream(screenshotPath)
        }, {
            caption: caption,
            parse_mode: 'Markdown'
        });

        console.log(`📤 Screenshot sent to admin: ${screenshotPath}`);
    } catch (sendError) {
        console.error('Failed to send screenshot to admin:', sendError);
    }
}

// FIX: Thêm null checks cho tất cả database operations
async function canCheckToday(userId) {
    if (isAdmin(userId)) return true;

    try {
        await db.read();
        const today = new Date().toISOString().slice(0, 10);

        if (!db.data) db.data = { users: {} };
        if (!db.data.users) db.data.users = {};
        if (!db.data.users[userId]) db.data.users[userId] = { checks: {} };
        if (!db.data.users[userId].checks) db.data.users[userId].checks = {};
        if (!db.data.users[userId].checks[today]) db.data.users[userId].checks[today] = 0;

        await db.write();
        return db.data.users[userId].checks[today] < 10;
    } catch (error) {
        console.error('Error in canCheckToday:', error);
        return false;
    }
}

async function recordCheck(userId) {
    if (isAdmin(userId)) return;

    try {
        await db.read();
        const today = new Date().toISOString().slice(0, 10);

        if (!db.data) db.data = { users: {} };
        if (!db.data.users) db.data.users = {};
        if (!db.data.users[userId]) db.data.users[userId] = { checks: {} };
        if (!db.data.users[userId].checks) db.data.users[userId].checks = {};
        if (!db.data.users[userId].checks[today]) db.data.users[userId].checks[today] = 0;

        db.data.users[userId].checks[today]++;
        await db.write();
    } catch (error) {
        console.error('Error in recordCheck:', error);
    }
}

async function remainingChecks(userId) {
    if (isAdmin(userId)) return '∞';

    try {
        await db.read();
        const today = new Date().toISOString().slice(0, 10);

        if (!db.data || !db.data.users || !db.data.users[userId] || !db.data.users[userId].checks || !db.data.users[userId].checks[today]) {
            return 10;
        }

        return 10 - db.data.users[userId].checks[today];
    } catch (error) {
        console.error('Error in remainingChecks:', error);
        return 0;
    }
}

async function resetUserChecks(userId) {
    try {
        await db.read();
        const today = new Date().toISOString().slice(0, 10);

        if (!db.data) db.data = { users: {} };
        if (!db.data.users) db.data.users = {};
        if (!db.data.users[userId]) db.data.users[userId] = { checks: {} };
        if (!db.data.users[userId].checks) db.data.users[userId].checks = {};

        db.data.users[userId].checks[today] = 0;
        await db.write();
    } catch (error) {
        console.error('Error in resetUserChecks:', error);
    }
}

async function canCheckIP(ip) {
    if (ip === 'unknown') return true;

    try {
        await ipDb.read();
        const today = new Date().toISOString().slice(0, 10);

        if (!ipDb.data) ipDb.data = { ips: {} };
        if (!ipDb.data.ips) ipDb.data.ips = {};
        if (!ipDb.data.ips[ip]) ipDb.data.ips[ip] = {};
        if (!ipDb.data.ips[ip][today]) ipDb.data.ips[ip][today] = 0;

        await ipDb.write();
        return ipDb.data.ips[ip][today] < 20;
    } catch (error) {
        console.error('Error in canCheckIP:', error);
        return true;
    }
}

async function recordCheckIP(ip) {
    if (ip === 'unknown') return;

    try {
        await ipDb.read();
        const today = new Date().toISOString().slice(0, 10);

        if (!ipDb.data) ipDb.data = { ips: {} };
        if (!ipDb.data.ips) ipDb.data.ips = {};
        if (!ipDb.data.ips[ip]) ipDb.data.ips[ip] = {};
        if (!ipDb.data.ips[ip][today]) ipDb.data.ips[ip][today] = 0;

        ipDb.data.ips[ip][today]++;
        await ipDb.write();
    } catch (error) {
        console.error('Error in recordCheckIP:', error);
    }
}

async function setUserCaptcha(userId) {
    try {
        const { question, answer } = generateCaptcha();
        await captchaDb.read();

        if (!captchaDb.data) captchaDb.data = { captchas: {} };
        if (!captchaDb.data.captchas) captchaDb.data.captchas = {};

        captchaDb.data.captchas[userId] = { answer, timestamp: Date.now() };
        await captchaDb.write();
        return question;
    } catch (error) {
        console.error('Error in setUserCaptcha:', error);
        return 'Lỗi tạo captcha';
    }
}

async function checkUserCaptcha(userId, text) {
    try {
        await captchaDb.read();

        if (!captchaDb.data || !captchaDb.data.captchas) {
            return false;
        }

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
    } catch (error) {
        console.error('Error in checkUserCaptcha:', error);
        return false;
    }
}

// FIX: Sửa lỗi chính - thêm null checks
async function hasPendingCaptcha(userId) {
    try {
        await captchaDb.read();

        // FIX: Kiểm tra tất cả các level của object
        if (!captchaDb || !captchaDb.data || !captchaDb.data.captchas) {
            return false;
        }

        return !!captchaDb.data.captchas[userId];
    } catch (error) {
        console.error('Error in hasPendingCaptcha:', error);
        return false;
    }
}

// FIX: Sửa lỗi syntax "..." thừa
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

// FIX: Cải thiện checkBankAccount với logic click tab và timeout ngắn hơn
async function checkBankAccount(accountNumber) {
    const browser = await getBrowser();
    const page = await browser.newPage();

    try {
        console.log(`[${new Date().toISOString()}] Checking account: ${accountNumber}`);

        // FIX: Tăng timeout lên 45s cho môi trường production
        await page.setDefaultNavigationTimeout(45000);
        await page.setDefaultTimeout(45000);

        await page.setExtraHTTPHeaders({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        });

        // FIX: Tăng delay để tránh bị block
        await new Promise(resolve => setTimeout(resolve, Math.random() * 5000 + 3000)); // 3-8s

        console.log(`[${new Date().toISOString()}] Navigating to muabanpm.com`);
        await page.goto('https://muabanpm.com', {
            waitUntil: 'networkidle2', // Đợi network idle thay vì domcontentloaded
            timeout: 45000
        });

        console.log(`[${new Date().toISOString()}] Page loaded, looking for tabs`);

        // FIX: Kiểm tra tab có tồn tại trước khi click
        const tabExists = await page.evaluate(() => {
            const tabs = Array.from(document.querySelectorAll('.tab .item'));
            const buyTab = tabs.find(tab => tab.innerText.includes('Mua USDT'));
            return !!buyTab;
        });

        if (!tabExists) {
            throw new Error('Không tìm thấy tab Mua USDT - giao diện có thể đã thay đổi');
        }

        // Click vào tab "Mua USDT"
        await page.evaluate(() => {
            const tabs = Array.from(document.querySelectorAll('.tab .item'));
            const buyTab = tabs.find(tab => tab.innerText.includes('Mua USDT'));
            if (buyTab) {
                buyTab.click();
                console.log('Clicked Mua USDT tab');
            }
        });

        console.log(`[${new Date().toISOString()}] Clicked tab, waiting for form`);
        await new Promise(resolve => setTimeout(resolve, 3000)); // Tăng delay

        // FIX: Tăng timeout cho selector
        await page.waitForSelector('#input-from', {
            timeout: 30000,
            visible: true
        });

        console.log(`[${new Date().toISOString()}] Input field found, typing account number`);

        // FIX: Clear input trước khi type
        await page.click('#input-from', { clickCount: 3 }); // Select all
        await page.type('#input-from', accountNumber, { delay: 150 + Math.random() * 100 });

        // FIX: Thêm nhiều cách trigger event
        await page.keyboard.press('Tab');
        await page.evaluate(() => {
            const input = document.querySelector('#input-from');
            if (input) {
                input.blur();
                input.dispatchEvent(new Event('change', { bubbles: true }));
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });

        console.log(`[${new Date().toISOString()}] Waiting for account name to load`);
        await new Promise(resolve => setTimeout(resolve, 4000)); // Tăng delay

        // FIX: Tăng timeout và cải thiện logic check
        await page.waitForFunction(
            () => {
                const el = document.querySelector('#addon-from');
                if (!el) return false;

                const text = el.innerText?.trim();
                console.log('Current text:', text);

                return text &&
                    text !== 'Loading...' &&
                    text !== '' &&
                    text !== '-' &&
                    text.length > 2 &&
                    !text.toLowerCase().includes('loading');
            },
            {
                timeout: 35000,
                polling: 1000 // Check mỗi 1s
            }
        );

        console.log(`[${new Date().toISOString()}] Account name loaded, extracting data`);

        // FIX: Cải thiện logic extract data
        const result = await page.evaluate(() => {
            const data = [];
            const nameEl = document.querySelector('#addon-from');
            const name = nameEl?.innerText?.trim();

            console.log('Extracted name:', name);

            // Kiểm tra các trường hợp không tìm thấy
            if (!name ||
                name.toLowerCase().includes('loading') ||
                name.toLowerCase().includes('không tìm thấy') ||
                name.toLowerCase().includes('not found') ||
                name.toLowerCase().includes('error') ||
                name === '' ||
                name === '-' ||
                name.length < 3) {
                return ['❌ Không tìm thấy thông tin tài khoản'];
            }

            data.push('✅ ' + name);

            // Lấy danh sách ngân hàng với retry
            try {
                const bankElements = document.querySelectorAll('#pay-from .pay');
                console.log('Found bank elements:', bankElements.length);

                if (bankElements.length > 0) {
                    bankElements.forEach(el => {
                        const text = el.textContent?.trim();
                        if (text && text !== '' && text !== '-' && text.length > 1) {
                            data.push(text);
                        }
                    });
                }
            } catch (bankError) {
                console.log('Error getting banks:', bankError);
            }

            return data;
        });

        // FIX: Validate kết quả
        if (!result || result.length === 0) {
            console.log(`[${new Date().toISOString()}] No result returned for: ${accountNumber}`);
            await page.close();
            return ['❌ Không tìm thấy thông tin tài khoản'];
        }

        if (result.length === 1 && result[0].includes('❌')) {
            console.log(`[${new Date().toISOString()}] Account not found: ${accountNumber}`);
            await page.close();
            return result;
        }

        console.log(`[${new Date().toISOString()}] Account check success: ${accountNumber}`, result);
        await page.close();
        return result;

    } catch (err) {
        console.error(`[${new Date().toISOString()}] Account check error: ${accountNumber}`, err.message);
        console.error('Full error:', err);

        // FIX: Chụp screenshot với thông tin chi tiết hơn
        let screenshotPath = null;
        try {
            screenshotPath = await captureErrorScreenshot(page, accountNumber, err);
        } catch (screenshotError) {
            console.error('Screenshot error:', screenshotError);
        }

        await page.close();

        // FIX: Phân loại lỗi chi tiết hơn
        if (err.message.includes('timeout') || err.message.includes('Waiting failed')) {
            return [`❌ Trang web phản hồi chậm, vui lòng thử lại sau 1-2 phút.`, screenshotPath];
        }
        if (err.message.includes('Navigation timeout')) {
            return [`❌ Không thể kết nối tới website, vui lòng thử lại sau.`, screenshotPath];
        }
        if (err.message.includes('Không tìm thấy tab')) {
            return [`❌ Giao diện website đã thay đổi, đang cập nhật bot.`, screenshotPath];
        }
        if (err.message.includes('net::ERR_')) {
            return [`❌ Lỗi kết nối mạng, vui lòng thử lại sau.`, screenshotPath];
        }

        return [`❌ Lỗi hệ thống: ${err.message}`, screenshotPath];
    }
}
// FIX: Thêm hàm lấy IP từ context

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
        (isAdminUser ? `• /stats - Thống kê hệ thống\n• /reset - Reset lượt user\n• /screenshots - Xem screenshots lỗi\n` : '') +
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
        (isAdminUser ? `\n🔧 *Lệnh Admin:*\n• /stats - Thống kê hệ thống\n• /reset - Reset lượt user\n• /screenshots - Xem screenshots lỗi\n` : '') +
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
        try {
            await db.read();
            const today = new Date().toISOString().slice(0, 10);
            let resetCount = 0;

            if (db.data && db.data.users) {
                for (const userId in db.data.users) {
                    if (db.data.users[userId].checks && db.data.users[userId].checks[today]) {
                        db.data.users[userId].checks[today] = 0;
                        resetCount++;
                    }
                }
            }

            await db.write();
            const resetAllMsg = `✅ *RESET THÀNH CÔNG*\n\n` +
                `🔄 Đã reset lượt kiểm tra cho *${resetCount}* user\n` +
                `📅 Ngày: ${new Date().toLocaleDateString('vi-VN')}\n\n` +
                `_Tất cả user đã được khôi phục 10 lượt kiểm tra._`;
            ctx.reply(resetAllMsg, { parse_mode: 'Markdown' });
        } catch (error) {
            ctx.reply('❌ Lỗi khi reset tất cả user', { parse_mode: 'Markdown' });
        }

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

// Thêm command xem screenshots (Admin only)
bot.command('screenshots', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        ctx.reply('🚫 *KHÔNG CÓ QUYỀN*\n\n_Chỉ admin mới có thể xem screenshots._', { parse_mode: 'Markdown' });
        return;
    }

    try {
        const files = fs.readdirSync(screenshotDir)
            .filter(file => file.endsWith('.png'))
            .sort((a, b) => fs.statSync(path.join(screenshotDir, b)).mtime - fs.statSync(path.join(screenshotDir, a)).mtime)
            .slice(0, 10); // 10 screenshots mới nhất

        if (files.length === 0) {
            ctx.reply('📁 *KHÔNG CÓ SCREENSHOTS*\n\n_Chưa có screenshot lỗi nào được lưu._', { parse_mode: 'Markdown' });
            return;
        }

        let msg = `📸 *SCREENSHOTS GẦN ĐÂY*\n\n`;
        files.forEach((file, index) => {
            const stats = fs.statSync(path.join(screenshotDir, file));
            msg += `${index + 1}. \`${file}\`\n📅 ${stats.mtime.toLocaleString('vi-VN')}\n\n`;
        });

        ctx.reply(msg, { parse_mode: 'Markdown' });
    } catch (error) {
        ctx.reply('❌ Lỗi khi lấy danh sách screenshots', { parse_mode: 'Markdown' });
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
        `⏳ _Vui lòng đợi trong giây lát (có thể mất 15-30s)..._`;
    const processingMessage = await ctx.reply(processingMsg, { parse_mode: 'Markdown' });

    const result = await checkBankAccount(acc);

    // Kiểm tra nếu có screenshot path trong result
    let screenshotPath = null;
    let cleanResult = result;

    if (result.length > 1 && result[1] && result[1].includes('.png')) {
        screenshotPath = result[1];
        cleanResult = [result[0]]; // Chỉ lấy message, bỏ screenshot path

        // Gửi screenshot cho admin nếu có lỗi
        if (result[0].includes('❌')) {
            await sendScreenshotToAdmin(screenshotPath, acc, result[0]);
        }
    }

    const formattedResult = formatBankResult(cleanResult, acc);

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

    try {
        await db.read();
        const users = db.data && db.data.users ? Object.keys(db.data.users).length : 0;
        let totalChecks = 0;
        let todayChecks = 0;
        const today = new Date().toISOString().slice(0, 10);

        if (db.data && db.data.users) {
            for (const user of Object.values(db.data.users)) {
                if (user.checks) {
                    for (const [date, count] of Object.entries(user.checks)) {
                        totalChecks += count;
                        if (date === today) todayChecks += count;
                    }
                }
            }
        }

        const statsMsg = `📈 *THỐNG KÊ HỆ THỐNG*\n\n` +
            `👥 Tổng số user: *${users}*\n` +
            `🔢 Tổng lượt check: *${totalChecks}*\n` +
            `📅 Hôm nay: *${todayChecks}*\n` +
            `🔧 Admin: *${ctx.from.first_name}*\n\n` +
            `⏰ _Cập nhật: ${new Date().toLocaleString('vi-VN')}_`;

        ctx.reply(statsMsg, { parse_mode: 'Markdown' });
    } catch (error) {
        ctx.reply('❌ Lỗi khi lấy thống kê', { parse_mode: 'Markdown' });
    }
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
    <h1>🏦 Bank Account Checker Bot (Railway)</h1>
    <p>✅ Bot is running successfully!</p>
    <p>📊 Status: Active</p>
    <p>🌐 Environment: Production</p>
    <p>⏰ Last check: ${new Date().toLocaleString('vi-VN')}</p>
  `);
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: 'production'
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

// Auto cleanup screenshots cũ
function cleanupOldScreenshots() {
    try {
        const files = fs.readdirSync(screenshotDir);
        const now = Date.now();
        const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 ngày

        files.forEach(file => {
            const filepath = path.join(screenshotDir, file);
            const stats = fs.statSync(filepath);

            if (now - stats.mtime.getTime() > maxAge) {
                fs.unlinkSync(filepath);
                console.log(`🗑️ Deleted old screenshot: ${file}`);
            }
        });
    } catch (error) {
        console.error('Error cleaning up screenshots:', error);
    }
}

// Chạy cleanup mỗi 24h
setInterval(cleanupOldScreenshots, 24 * 60 * 60 * 1000);

// FIX: Cải thiện error handler
bot.catch((err, ctx) => {
    console.error('Bot error:', err);
    const errorMsg = `⚠️ *LỖI HỆ THỐNG*\n\n` +
        `🔧 Bot đang gặp sự cố tạm thời.\n\n` +
        `_Vui lòng thử lại sau ít phút._`;

    try {
        ctx.reply(errorMsg, { parse_mode: 'Markdown' });
    } catch (replyError) {
        console.error('Failed to send error message:', replyError);
    }
});

startBot();

module.exports = app;
