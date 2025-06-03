const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors()); // Cho phép gọi từ bất kỳ frontend nào

// Endpoint kiểm tra tài khoản
app.get("/check-account", async (req, res) => {
    const account = req.query.account;
    if (!account || !/^\d{4,19}$/.test(account)) {
        return res.status(400).json({ error: "Số tài khoản không hợp lệ" });
    }

    const ts = Date.now();
    const url = `https://muabanpm.com/api/account.php?id=from&account=${account}&ts=${ts}`;

    try {
        const response = await axios.get(url, {
            headers: {
                Referer: "https://muabanpm.com/",
                Origin: "https://muabanpm.com/",
                "User-Agent": "Mozilla/5.0"
            }
        });

        res.json({ result: response.data });
    } catch (error) {
        res.status(500).json({ error: "Không thể gọi API hoặc bị chặn" });
    }
});

// Start server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server chạy tại http://localhost:${PORT}`);
});
