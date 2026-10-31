import { buildXLSXFromObjects } from './xlsx_builder.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { responses } = req.body;
    if (!responses) {
        return res.status(400).json({ error: 'No data provided' });
    }

    const botToken = process.env.BALE_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
    const chatIdsString = process.env.BALE_CHAT_IDS || process.env.TELEGRAM_CHAT_IDS; 
    
    if (!botToken || !chatIdsString) {
        console.error("Missing BALE_BOT_TOKEN or BALE_CHAT_IDS in environment variables.");
        return res.status(500).json({ error: 'Server configuration missing' });
    }

    const chatIds = chatIdsString.split(',').map(id => id.trim()).filter(Boolean);

    // ۱. ساخت متن پیام
    const orderInfo = responses.appliance_order_fa || responses.appliance_order;
    let messageText = "📋 ثبت جدید پاسخ‌نامه (بله):\n";
    if (orderInfo) {
        messageText += `🔄 ترتیب نمایش: ${orderInfo}\n`;
    }
    messageText += "\n";

    for (const [key, value] of Object.entries(responses)) {
        messageText += `- ${key}: ${value}\n`;
    }

    // ۲. ساختاردهی اطلاعات به فرمت CSV
    const escapeCSV = (val) => `"${String(val).replace(/"/g, '""')}"`;
    const csvHeaders = Object.keys(responses).map(escapeCSV).join(',');
    const csvValues = Object.values(responses).map(escapeCSV).join(',');
    const csvString = '\uFEFF' + csvHeaders + '\n' + csvValues;



    // ۳. ساخت فایل اکسل (XLSX)
    const xlsxBuffer = buildXLSXFromObjects([responses], 'SurveyResponse');
    const timestamp = Date.now();

    try {
        const sendPromises = chatIds.map(async (chatId) => {
            try {
                // الف) ارسال پیام متنی
                await fetch(`https://tapi.bale.ai/bot${botToken}/sendMessage`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ chat_id: chatId, text: messageText })
                });

                // ب) ارسال فایل CSV
                const formCsv = new FormData();
                formCsv.append('chat_id', chatId);
                formCsv.append('caption', '📁 فایل خروجی داده‌ها (CSV)');
                const csvBlob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
                formCsv.append('document', csvBlob, `survey_result_${timestamp}.csv`);
                await fetch(`https://tapi.bale.ai/bot${botToken}/sendDocument`, { method: "POST", body: formCsv });

                // ج) ارسال فایل Excel (.xlsx)
                const formXlsx = new FormData();
                formXlsx.append('chat_id', chatId);
                formXlsx.append('caption', '📊 فایل خروجی اکسل (Excel .xlsx)');
                const xlsxBlob = new Blob([xlsxBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                formXlsx.append('document', xlsxBlob, `survey_result_${timestamp}.xlsx`);
                await fetch(`https://tapi.bale.ai/bot${botToken}/sendDocument`, { method: "POST", body: formXlsx });

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
