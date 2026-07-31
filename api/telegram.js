// api/telegram.js

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { responses } = req.body;
    if (!responses) {
        return res.status(400).json({ error: 'No data provided' });
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatIdsString = process.env.TELEGRAM_CHAT_IDS; 
    
    if (!botToken || !chatIdsString) {
        return res.status(500).json({ error: 'Server configuration missing' });
    }

    const chatIds = chatIdsString.split(',');

    // ۱. ساخت متن پیام برای ارسال سریع
    let messageText = "📋 *ثبت جدید پاسخ‌نامه*\n\n";
    for (const [key, value] of Object.entries(responses)) {
        messageText += `• *${key}:* ${value}\n`;
    }

    // ۲. ساختاردهی اطلاعات به فرمت CSV
    // فرار دادن مقادیر درون دابل‌کوتیشن برای جلوگیری از مشکل کاما در متن‌ها
    const escapeCSV = (val) => `"${String(val).replace(/"/g, '""')}"`;
    const csvHeaders = Object.keys(responses).map(escapeCSV).join(',');
    const csvValues = Object.values(responses).map(escapeCSV).join(',');
    
    // کاراکتر \uFEFF (BOM) باعث می‌شود اکسل حروف فارسی را به درستی تشخیص دهد
    const csvString = '\uFEFF' + csvHeaders + '\n' + csvValues;

    try {
        const sendPromises = chatIds.map(async (chatId) => {
            const trimmedChatId = chatId.trim();

            // الف) ارسال پیام متنی (اختیاری برای دیدن سریع نتایج)
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: trimmedChatId,
                    text: messageText,
                    parse_mode: "Markdown"
                })
            });

            // ب) ارسال فایل CSV
            const formData = new FormData();
            formData.append('chat_id', trimmedChatId);
            formData.append('caption', '📁 فایل خروجی (CSV)');
            
            // تبدیل استرینگ به فایل برای ارسال در فرم‌دیتا
            const csvBlob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
            
            // ایجاد نام فایل بر اساس تاریخ و زمان
            const fileName = `survey_result_${Date.now()}.csv`;
            formData.append('document', csvBlob, fileName);

            // فراخوانی متد sendDocument از API تلگرام
            return fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
                method: "POST",
                body: formData
            });
        });

        // صبر می‌کنیم تا ارسال برای تمام Chat ID ها انجام شود
        await Promise.all(sendPromises);
        return res.status(200).json({ success: true });
        
    } catch (error) {
        console.error("Telegram Error:", error);
        return res.status(500).json({ error: 'Failed to send telegram message' });
    }
}