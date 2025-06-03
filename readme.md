````markdown
# 🏦 Bank Account Checker Bot

A powerful Telegram bot for checking Vietnamese bank account holder information via [muabanpm.com](https://muabanpm.com), equipped with rate limiting, CAPTCHA, admin control, and production-ready deployment.

[🇻🇳 Tiếng Việt](#tiếng-việt) | [🇺🇸 English](#english)

---

## 🇺🇸 English

### ✨ Features

- ✅ Check bank account holder names (via muabanpm.com)
- 🚫 Daily usage limits: 10 per user, 20 per IP
- 🔐 CAPTCHA triggered upon reaching limits
- 👨‍💻 Admin dashboard: unlimited checks, reset users, view stats
- 🐛 Error screenshot auto-send to admin
- 🗃️ Local JSON DB via `lowdb`
- ⚙️ Ready for deployment (e.g. Railway)

---

### ⚡ Quick Start

#### 🧱 Prerequisites
- Node.js v18+
- Telegram Bot Token via [@BotFather](https://t.me/BotFather)
- Railway account (optional for deployment)

#### 💻 Local Development

```bash
git clone https://github.com/your-username/bank-checker-bot.git
cd bank-checker-bot
npm install
````

Create `.env`:

```env
BOT_TOKEN=your_telegram_bot_token
ADMIN_ID=your_telegram_user_id
PORT=3000
```

Start bot:

```bash
node server.js
```

Set up public tunnel:

```bash
ngrok http 3000
```

Set Telegram webhook:

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
     -d "url=https://your-ngrok-subdomain.ngrok-free.app/telegram"
```

---

#### ☁️ Deploy to Railway

```bash
npm install -g @railway/cli
railway login
railway init
```

Set environment variables:

```bash
railway variables set BOT_TOKEN=your_token
railway variables set ADMIN_ID=your_id
railway variables set WEBHOOK_URL=https://your-app-name.up.railway.app
```

Deploy:

```bash
railway up
```

Set webhook:

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
     -d "url=https://your-app-name.up.railway.app/telegram"
```

---

### 📱 User Guide

#### 👤 For Users

* `/start` – Begin using the bot
* Send bank account number (9–14 digits)
* `/checklimit` – See remaining daily checks
* `/help` – Instructions

#### 🔐 For Admins

* `/stats` – Show usage stats
* `/reset <user_id>` – Reset individual user
* `/reset all` – Reset all users
* `/screenshots` – Review error captures

---

### ⚙️ Configuration

#### Environment Variables

| Variable      | Description                        | Required |
| ------------- | ---------------------------------- | -------- |
| `BOT_TOKEN`   | Telegram bot token from @BotFather | ✅        |
| `ADMIN_ID`    | Telegram user ID                   | ✅        |
| `WEBHOOK_URL` | Public URL for webhook (prod only) | ✅        |
| `PORT`        | Server port (default: 3000)        | ❌        |

#### Rate Limits

* 👤 Users: 10 checks/day
* 🌐 IPs: 20 checks/day
* 🔓 Admin: Unlimited
* 🧠 CAPTCHA: Required if exceeded

---

### 📡 API Endpoints

| Method | Endpoint    | Description        |
| ------ | ----------- | ------------------ |
| GET    | `/`         | Health check page  |
| GET    | `/health`   | JSON system status |
| POST   | `/telegram` | Telegram webhook   |

---

### 🛠️ Tech Stack

* **Node.js** + **Express**
* **Telegraf** (Telegram bot framework)
* **Puppeteer** (web scraping)
* **lowdb** (JSON-based DB)
* **Railway** (deployment)

---

### 🧷 Security

* Input validation for bank accounts
* CAPTCHA challenge on abuse
* Admin-only command access
* IP-based request throttling

---

## 🇻🇳 Tiếng Việt

### ✨ Tính năng

* ✅ Tra cứu tên chủ tài khoản ngân hàng (qua muabanpm.com)
* 🚫 Giới hạn: 10 lượt/người/ngày, 20 lượt/IP/ngày
* 🔐 CAPTCHA khi vượt giới hạn
* 👨‍💻 Admin: không giới hạn, reset user, xem thống kê
* 🐛 Tự động chụp lỗi và gửi admin
* 🗃️ Dữ liệu lưu bằng lowdb
* ⚙️ Sẵn sàng triển khai lên Railway

---

### ⚡ Bắt đầu nhanh

#### 🧱 Yêu cầu

* Node.js >= 18
* Token từ [@BotFather](https://t.me/BotFather)
* Railway (nếu deploy online)

#### 💻 Phát triển local

```bash
git clone https://github.com/your-username/bank-checker-bot.git
cd bank-checker-bot
npm install
```

Tạo `.env`:

```env
BOT_TOKEN=token_cua_ban
ADMIN_ID=id_telegram_cua_ban
PORT=3000
```

Chạy bot:

```bash
node server.js
```

Mở tunnel:

```bash
ngrok http 3000
```

Thiết lập webhook:

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
     -d "url=https://ten-cua-ban.ngrok-free.app/telegram"
```

---

#### ☁️ Deploy lên Railway

```bash
npm install -g @railway/cli
railway login
railway init
```

Thiết lập biến môi trường:

```bash
railway variables set BOT_TOKEN=token_bot
railway variables set ADMIN_ID=id_admin
railway variables set WEBHOOK_URL=https://ten-app.railway.app
```

Deploy:

```bash
railway up
```

Thiết lập webhook:

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
     -d "url=https://ten-app.railway.app/telegram"
```

---

### 📱 Hướng dẫn sử dụng

#### 👤 Cho người dùng

* `/start` – Bắt đầu sử dụng
* Gửi số tài khoản 9–14 chữ số
* `/checklimit` – Xem số lượt còn lại
* `/help` – Xem hướng dẫn

#### 🔐 Cho admin

* `/stats` – Xem thống kê
* `/reset <user_id>` – Reset lượt người dùng
* `/reset all` – Reset toàn bộ
* `/screenshots` – Xem lỗi đã chụp

---

### ⚙️ Cấu hình

| Biến          | Mô tả                            | Bắt buộc |
| ------------- | -------------------------------- | -------- |
| `BOT_TOKEN`   | Token bot từ @BotFather          | ✅        |
| `ADMIN_ID`    | ID Telegram của bạn              | ✅        |
| `WEBHOOK_URL` | Đường dẫn webhook (deploy)       | ✅        |
| `PORT`        | Port chạy server (mặc định 3000) | ❌        |

---

### 📡 API

* `GET /` – Kiểm tra bot chạy
* `GET /health` – Tình trạng bot
* `POST /telegram` – Webhook Telegram

---

### 🧷 Bảo mật

* Kiểm tra định dạng số tài khoản
* Giới hạn theo IP và user
* CAPTCHA chống spam
* Lệnh admin có kiểm soát

---

### 🤝 Đóng góp

```bash
git checkout -b feature/new-feature
git commit -m "Add feature"
git push origin feature/new-feature
```

Mở Pull Request để được review 🎉

---

### 📄 License

Distributed under MIT License. See `LICENSE`.

---

### 💬 Liên hệ

* Telegram: [@your\_username](https://t.me/your_username)
* Email: [your.email@example.com](mailto:your.email@example.com)

---

⭐ Nếu thấy hữu ích, hãy cho project một star nhé!
❤️ Made for the Vietnamese tech community.

```
```
