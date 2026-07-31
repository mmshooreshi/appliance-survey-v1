// api/telegram.js

export default async function handler(req, res) {
    // فقط درخواست‌های POST مجاز هستند
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { responses } = req.body;
    if (!responses) {
        return res.status(400).json({ error: 'No data provided' });
    }

    // خواندن توکن و آیدی‌ها از محیط امن Vercel
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatIdsString = process.env.TELEGRAM_CHAT_IDS; 
    
    if (!botToken || !chatIdsString) {
        return res.status(500).json({ error: 'Server configuration missing' });
    }

    // تبدیل رشته آیدی‌ها به آرایه (با فرض اینکه آیدی‌ها با کاما جدا شده‌اند)
    const chatIds = chatIdsString.split(',');

    // ساخت متن پیام
    let messageText = "📋 *ثبت جدید پاسخ‌نامه*\n\n";
    for (const [key, value] of Object.entries(responses)) {
        messageText += `• *${key}:* ${value}\n`;
    }

    try {
        // ارسال پیام به تمامی Chat ID ها به صورت همزمان
        const sendPromises = chatIds.map(chatId => {
            return fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: chatId.trim(),
                    text: messageText,
                    parse_mode: "Markdown"
                })
            });
        });

        await Promise.all(sendPromises);
        return res.status(200).json({ success: true });
        
    } catch (error) {
        console.error("Telegram Error:", error);
        return res.status(500).json({ error: 'Failed to send telegram message' });
    }
}