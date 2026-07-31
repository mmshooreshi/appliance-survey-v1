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
        console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_IDS in environment variables.");
        return res.status(500).json({ error: 'Server configuration missing' });
    }

    // پاکسازی فاصله‌های اضافی از دور آیدی‌ها
    const chatIds = chatIdsString.split(',').map(id => id.trim()).filter(Boolean);

    // ۱. ساخت متن پیام ساده (بدون فرمت‌های پیچیده که باعث خطای Markdown/HTML می‌شوند)
    let messageText = "ثبت جدید پاسخ‌نامه:\n\n";
    for (const [key, value] of Object.entries(responses)) {
        messageText += `- ${key}: ${value}\n`;
    }

    // ۲. ساختاردهی اطلاعات به فرمت CSV
    const escapeCSV = (val) => `"${String(val).replace(/"/g, '""')}"`;
    const csvHeaders = Object.keys(responses).map(escapeCSV).join(',');
    const csvValues = Object.values(responses).map(escapeCSV).join(',');
    const csvString = '\uFEFF' + csvHeaders + '\n' + csvValues;

    try {
        const sendPromises = chatIds.map(async (chatId) => {
            try {
                // الف) ارسال پیام متنی ساده (بدون parse_mode برای جلوگیری از هرگونه خطای کاراکتر خاص)
                const textRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        chat_id: chatId,
                        text: messageText
                    })
                });
                
                const textResultData = await textRes.json();
                if (!textResultData.ok) {
                    console.error(`Telegram sendMessage error for ${chatId}:`, textResultData);
                }

                // ب) ارسال فایل CSV
                const formData = new FormData();
                formData.append('chat_id', chatId);
                formData.append('caption', '📁 فایل خروجی (CSV)');
                
                const csvBlob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
                const fileName = `survey_result_${Date.now()}.csv`;
                formData.append('document', csvBlob, fileName);

                const docRes = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
                    method: "POST",
                    body: formData
                });

                const docResultData = await docRes.json();
                if (!docResultData.ok) {
                    console.error(`Telegram sendDocument error for ${chatId}:`, docResultData);
                }

                return true;
            } catch (innerErr) {
                console.error(`Failed for chatId ${chatId}:`, innerErr);
                return false;
            }
        });

        await Promise.all(sendPromises);
        return res.status(200).json({ success: true });
        
    } catch (error) {
        console.error("Telegram Global Error:", error);
        return res.status(500).json({ error: 'Failed to send telegram message' });
    }
}