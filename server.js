const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const PORT = 3000;

async function checkBankAccount(account) {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    try {
        await page.goto('https://muabanpm.com', { waitUntil: 'domcontentloaded' });

        // Chọn tab "Bán USDT"
        await page.evaluate(() => {
            const tab = Array.from(document.querySelectorAll('.tab .item'))
                .find(el => el.innerText.includes('Bán USDT'));
            if (tab) tab.click();
        });

        // Đợi form sẵn sàng
        await page.waitForSelector('#input-to', { timeout: 10000 });

        // Nhập số tài khoản
        await page.type('#input-to', account, { delay: 100 });

        // Giả lập blur
        await page.keyboard.press('Tab');

        // Đợi hệ thống điền tên chủ tài khoản (vượt qua "Loading...")
        await page.waitForFunction(
            () => {
                const el = document.querySelector('#addon-to');
                const text = el?.innerText?.trim();
                return text && text !== 'Loading...' && text.length > 3;
            },
            { timeout: 10000 }
        );

        // Trích xuất kết quả
        const result = await page.evaluate(() => {
            const name = document.querySelector('#addon-to')?.innerText.trim() || 'Không rõ';
            const banks = Array.from(document.querySelectorAll('#pay-to .pay'))
                .map(el => el.innerText.trim());
            return [`✅ ${name}`, ...banks];
        });

        return result;
    } catch (err) {
        return [`❌ Lỗi: ${err.message}`];
    } finally {
        await browser.close();
    }
}

app.get('/check', async (req, res) => {
    const account = req.query.account;

    if (!account) {
        return res.status(400).json({ result: ['⚠️ Vui lòng cung cấp số tài khoản'] });
    }

    const result = await checkBankAccount(account);
    res.json({ result });
});

app.listen(PORT, () => {
    console.log(`✅ Bank Checker API đang chạy tại http://localhost:${PORT}`);
});
