// api/bale.js

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { responses } = req.body;
    if (!responses) {
        return res.status(400).json({ error: 'No data provided' });
    }

    // دریافت توکن و چت‌آیدی بله از متغیرهای محیطی
    // در صورت عدم تنظیم BALE_BOT_TOKEN، از TELEGRAM_BOT_TOKEN استفاده می‌شود
    const botToken = process.env.BALE_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
    const chatIdsString = process.env.BALE_CHAT_IDS || process.env.TELEGRAM_CHAT_IDS; 
    
    if (!botToken || !chatIdsString) {
        console.error("Missing BALE_BOT_TOKEN or BALE_CHAT_IDS in environment variables.");
        return res.status(500).json({ error: 'Server configuration missing' });
    }

    const chatIds = chatIdsString.split(',').map(id => id.trim()).filter(Boolean);

    // ۱. ساخت متن پیام
    let messageText = "📋 ثبت جدید پاسخ‌نامه (بله):\n\n";
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
                // الف) ارسال پیام متنی به پیام‌رسان بله
                const textRes = await fetch(`https://tapi.bale.ai/bot${botToken}/sendMessage`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        chat_id: chatId,
                        text: messageText
                    })
                });
                
                const textResultData = await textRes.json();
                if (!textResultData.ok) {
                    console.error(`Bale sendMessage error for ${chatId}:`, textResultData);
                }

                // ب) ارسال فایل CSV به پیام‌رسان بله
                const formData = new FormData();
                formData.append('chat_id', chatId);
                formData.append('caption', '📁 فایل خروجی (CSV)');
                
                const csvBlob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
                const fileName = `survey_result_${Date.now()}.csv`;
                formData.append('document', csvBlob, fileName);

                const docRes = await fetch(`https://tapi.bale.ai/bot${botToken}/sendDocument`, {
                    method: "POST",
                    body: formData
                });

                const docResultData = await docRes.json();
                if (!docResultData.ok) {
                    console.error(`Bale sendDocument error for ${chatId}:`, docResultData);
                }

                return true;
            } catch (innerErr) {
                console.error(`Failed Bale send for chatId ${chatId}:`, innerErr);
                return false;
            }
        });

        await Promise.all(sendPromises);
        return res.status(200).json({ success: true });
        
    } catch (error) {
        console.error("Bale Global Error:", error);
        return res.status(500).json({ error: 'Failed to send bale message' });
    }
}
