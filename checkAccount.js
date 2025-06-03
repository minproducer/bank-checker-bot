const puppeteer = require('puppeteer');

async function checkBankAccount(accountNumber) {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.goto('https://muabanpm.com', { waitUntil: 'domcontentloaded' });

        // Nhấn vào tab "Bán USDT" để hiện form nhập
        await page.evaluate(() => {
            const sellTab = document.querySelector('.tab .item[title="Bán USDT"]');
            if (sellTab) sellTab.click();
        });

        // Chờ form hiện
        await page.waitForSelector('#input-to', { timeout: 5000 });

        // Gõ số tài khoản
        await page.type('#input-to', accountNumber, { delay: 80 });

        // Blur (rời ô nhập) để kích hoạt API kiểm tra tài khoản
        await page.evaluate(() => {
            document.querySelector('#input-to').blur();
        });

        // Chờ phần tên tài khoản hiện ra (nằm trong #pay-to)
        await page.waitForFunction(() => {
            const div = document.querySelector('#pay-to');
            return div && div.innerText.trim().length > 0;
        }, { timeout: 7000 });

        // Lấy tên tài khoản
        const name = await page.$eval('#pay-to', el => el.innerText.trim());
        console.log(`✅ Chủ tài khoản: ${name}`);
    } catch (error) {
        console.error('❌ Lỗi:', error.message);
        await page.screenshot({ path: 'debug.png', fullPage: true });
        console.log('🖼️ Đã chụp ảnh màn hình lỗi: debug.png');
    } finally {
        await browser.close();
    }
}

// Nhận số tài khoản từ command line
const accountNumber = process.argv[2];
if (!accountNumber) {
    console.error('⚠️ Vui lòng nhập số tài khoản để kiểm tra!');
    process.exit(1);
}

checkBankAccount(accountNumber);
