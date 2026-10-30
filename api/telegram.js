// api/telegram.js
// Handles both survey submission notifications and interactive Telegram Bot commands

const BACKEND_URL = "http://91.212.174.223:9090/api/data";

const APPLIANCE_FA_MAP = {
    aligner: "الاینر شفاف",
    ceramic: "براکت سرامیکی",
    metal: "براکت فلزی"
};

// Helper to escape CSV values
const escapeCSV = (val) => `"${String(val !== undefined && val !== null ? val : '').replace(/"/g, '""')}"`;

// Helper: Reconstruct presentation order if not already saved
function detectApplianceOrder(row) {
    if (row.appliance_order) {
        const parts = row.appliance_order.replace(/>/g, ',').split(',').map(s => s.trim().toLowerCase());
        const valid = parts.filter(s => ['aligner', 'ceramic', 'metal'].includes(s));
        if (valid.length > 0) return valid;
    }
    const keys = Object.keys(row);
    const order = [];
    const seen = new Set();
    for (const k of keys) {
        for (const app of ['aligner', 'ceramic', 'metal']) {
            if (k.includes(app) && !seen.has(app)) {
                order.push(app);
                seen.add(app);
            }
        }
    }
    return order;
}

// Fetch live backend data
async function fetchBackendData() {
    try {
        const res = await fetch(BACKEND_URL, { headers: { 'User-Agent': 'TelegramBot/1.0' } });
        if (!res.ok) return [];
        const raw = await res.json();
        return raw.map(item => {
            const row = item.responses ? { ...item.responses } : { ...item };
            if (item.id && !row.id) row.id = item.id;
            if (item.timestamp && !row.timestamp) row.timestamp = item.timestamp;
            const order = detectApplianceOrder(row);
            row.appliance_order = order.join(' > ');
            row.appliance_order_fa = order.map(a => APPLIANCE_FA_MAP[a] || a).join(' > ');
            row.first_appliance = order[0] || '';
            row.second_appliance = order[1] || '';
            row.third_appliance = order[2] || '';
            return row;
        });
    } catch (e) {
        console.error("fetchBackendData error:", e);
        return [];
    }
}

// Filter dataset by date preset
function filterByDatePreset(data, preset) {
    if (!preset || preset === 'all') return data;
    const now = new Date();
    let cutoff = new Date();

    if (preset === 'today') {
        cutoff.setHours(0, 0, 0, 0);
    } else if (preset === '3days') {
        cutoff.setDate(now.getDate() - 3);
    } else if (preset === '7days') {
        cutoff.setDate(now.getDate() - 7);
    } else if (preset === '30days') {
        cutoff.setDate(now.getDate() - 30);
    }

    return data.filter(r => {
        if (!r.timestamp) return true;
        const d = new Date(r.timestamp.replace(' ', 'T'));
        return isNaN(d.getTime()) || d >= cutoff;
    });
}

// Calculate mean and SD
function calcMeanSD(values) {
    const nums = values.map(v => parseFloat(v)).filter(v => !isNaN(v));
    if (nums.length === 0) return { mean: '0.00', sd: '0.00', count: 0 };
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    const variance = nums.length > 1
        ? nums.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / (nums.length - 1)
        : 0;
    return { mean: mean.toFixed(2), sd: Math.sqrt(variance).toFixed(2), count: nums.length };
}

// Build CSV string from rows
function generateCSV(rows, fieldFilter = 'all') {
    if (!rows || rows.length === 0) return '\uFEFFNo data';
    
    let allKeys = new Set();
    // Prioritize key columns
    const priority = ['id', 'timestamp', 'appliance_order', 'appliance_order_fa', 'first_appliance', 'second_appliance', 'third_appliance', 'q_age', 'q_gender', 'q_edu'];
    priority.forEach(k => allKeys.add(k));

    rows.forEach(r => {
        Object.keys(r).forEach(k => {
            if (fieldFilter === 'demo' && !k.startsWith('q_') && !priority.includes(k)) return;
            if (fieldFilter === 'vas' && !k.startsWith('vas_') && !k.startsWith('acc_') && !priority.includes(k)) return;
            allKeys.add(k);
        });
    });

    const headers = Array.from(allKeys);
    const csvLines = [headers.map(escapeCSV).join(',')];

    for (const r of rows) {
        const line = headers.map(h => escapeCSV(r[h]));
        csvLines.push(line.join(','));
    }

    return '\uFEFF' + csvLines.join('\n');
}

// Send Telegram Message helper
async function sendTelegramMsg(botToken, chatId, text, replyMarkup = null, parseMode = null) {
    const payload = { chat_id: chatId, text: text };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    if (parseMode) payload.parse_mode = parseMode;

    return fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
}

// Send Telegram Document helper
async function sendTelegramDoc(botToken, chatId, fileContent, fileName, caption = '') {
    const formData = new FormData();
    formData.append('chat_id', chatId);
    if (caption) formData.append('caption', caption);
    const blob = new Blob([fileContent], { type: 'text/csv;charset=utf-8;' });
    formData.append('document', blob, fileName);

    return fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
        method: "POST",
        body: formData
    });
}

// Answer callback query
async function answerCallbackQuery(botToken, callbackQueryId, text = null) {
    const payload = { callback_query_id: callbackQueryId };
    if (text) payload.text = text;
    return fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
}

// MAIN HANDLER
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatIdsString = process.env.TELEGRAM_CHAT_IDS;

    if (!botToken || !chatIdsString) {
        console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_IDS in environment variables.");
        return res.status(500).json({ error: 'Server configuration missing' });
    }

    const authorizedChatIds = chatIdsString.split(',').map(id => id.trim()).filter(Boolean);

    // =========================================================================
    // CASE 1: Survey Submission from Frontend (req.body.responses)
    // =========================================================================
    if (req.body && req.body.responses) {
        const { responses } = req.body;
        const orderInfo = responses.appliance_order_fa || responses.appliance_order;

        let messageText = "📋 ثبت جدید پاسخ‌نامه:\n";
        if (orderInfo) {
            messageText += `🔄 ترتیب نمایش: ${orderInfo}\n`;
        }
        messageText += "\n";

        for (const [key, value] of Object.entries(responses)) {
            messageText += `- ${key}: ${value}\n`;
        }

        const csvString = generateCSV([responses]);

        try {
            const sendPromises = authorizedChatIds.map(async (chatId) => {
                await sendTelegramMsg(botToken, chatId, messageText);
                await sendTelegramDoc(botToken, chatId, csvString, `survey_${Date.now()}.csv`, '📁 فایل خروجی پاسخ‌نامه');
                return true;
            });
            await Promise.all(sendPromises);
            return res.status(200).json({ success: true });
        } catch (error) {
            console.error("Submission Send Error:", error);
            return res.status(500).json({ error: 'Failed to send telegram submission' });
        }
    }

    // =========================================================================
    // CASE 2: Interactive Telegram Bot Webhook (Commands & Callbacks)
    // =========================================================================
    const message = req.body.message;
    const callbackQuery = req.body.callback_query;

    const senderChatId = message ? String(message.chat.id) : (callbackQuery ? String(callbackQuery.message.chat.id) : null);

    if (!senderChatId) {
        return res.status(200).json({ ok: true });
    }

    // Security check: Only authorized researchers can query data
    if (!authorizedChatIds.includes(senderChatId)) {
        await sendTelegramMsg(botToken, senderChatId, "⛔ دسترسی غیرمجاز. شناسه شما در لیست مجاز پژوهشگران نیست.");
        return res.status(200).json({ ok: true });
    }

    // Handle Callback Queries (Inline Buttons)
    if (callbackQuery) {
        const data = callbackQuery.data;
        await answerCallbackQuery(botToken, callbackQuery.id);

        if (data === 'menu_main') {
            await showMainMenu(botToken, senderChatId);
        } else if (data === 'menu_stats') {
            await showStats(botToken, senderChatId);
        } else if (data === 'menu_daterange') {
            await showDateRangeMenu(botToken, senderChatId);
        } else if (data.startsWith('filter_date_')) {
            const preset = data.replace('filter_date_', '');
            await showDateSelectedMenu(botToken, senderChatId, preset);
        } else if (data.startsWith('export_csv_')) {
            const preset = data.replace('export_csv_', '');
            await sendExportCSV(botToken, senderChatId, preset, 'all');
        } else if (data.startsWith('export_demo_')) {
            const preset = data.replace('export_demo_', '');
            await sendExportCSV(botToken, senderChatId, preset, 'demo');
        } else if (data.startsWith('export_vas_')) {
            const preset = data.replace('export_vas_', '');
            await sendExportCSV(botToken, senderChatId, preset, 'vas');
        } else if (data === 'menu_thesis_metrics') {
            await showThesisComparison(botToken, senderChatId);
        } else if (data === 'menu_order_bias') {
            await showOrderBiasAnalysis(botToken, senderChatId);
        }

        return res.status(200).json({ ok: true });
    }

    // Handle Text Commands
    if (message && message.text) {
        const text = message.text.trim();
        if (text === '/start' || text === '/menu' || text === '/help') {
            await showMainMenu(botToken, senderChatId);
        } else if (text === '/stats') {
            await showStats(botToken, senderChatId);
        } else if (text === '/export') {
            await showDateRangeMenu(botToken, senderChatId);
        } else if (text === '/thesis' || text === '/compare') {
            await showThesisComparison(botToken, senderChatId);
        } else if (text === '/order' || text === '/bias') {
            await showOrderBiasAnalysis(botToken, senderChatId);
        } else {
            await showMainMenu(botToken, senderChatId, `دستور «${text}» شناسایی نشد. لطفاً از منوی زیر انتخاب کنید:`);
        }
        return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true });
}

// -----------------------------------------------------------------------------
// Interactive Bot UI Screens
// -----------------------------------------------------------------------------

async function showMainMenu(botToken, chatId, intro = null) {
    const text = intro || 
        "🎓 *سامانه مدیریت و تحلیل پژوهش زیبایی ارتودنسی*\n\n" +
        "لطفاً عملیات مورد نظر خود را برای پایان‌نامه انتخاب کنید:";

    const keyboard = {
        inline_keyboard: [
            [
                { text: "📊 آمار کلی و توزیع پاسخ‌ها", callback_data: "menu_stats" },
                { text: "📅 فیلتر بازه زمانی و خروجی", callback_data: "menu_daterange" }
            ],
            [
                { text: "📈 مقایسه میانگین دستگاه‌ها (تز)", callback_data: "menu_thesis_metrics" },
                { text: "🔄 تحلیل اثر ترتیب (Order Bias)", callback_data: "menu_order_bias" }
            ],
            [
                { text: "📥 دریافت فوری کل داده‌ها (CSV)", callback_data: "export_csv_all" }
            ]
        ]
    };

    return sendTelegramMsg(botToken, chatId, text, keyboard, "Markdown");
}

async function showStats(botToken, chatId) {
    const data = await fetchBackendData();
    if (data.length === 0) {
        return sendTelegramMsg(botToken, chatId, "⚠️ در حال حاضر هیچ پاسخی در سرور یافت نشد.");
    }

    const total = data.length;
    const latest = data[data.length - 1].timestamp || 'نامشخص';

    // Count order permutations
    const orderCounts = {};
    data.forEach(r => {
        const ord = r.appliance_order_fa || 'نامشخص';
        orderCounts[ord] = (orderCounts[ord] || 0) + 1;
    });

    let orderBreakdown = "";
    for (const [ord, cnt] of Object.entries(orderCounts)) {
        const pct = ((cnt / total) * 100).toFixed(1);
        orderBreakdown += `▪️ ${ord}:\n   👈 ${cnt} نفر (${pct}%)\n`;
    }

    const text = 
        `📊 *گزارش آمار کلی پژوهش*\n\n` +
        `👥 *تعداد کل پاسخ‌دهندگان:* ${total} نفر\n` +
        `🕒 *آخرین ثبت پاسخ:* ${latest}\n\n` +
        `🔄 *توزیع ترتیب مشاهده دستگاه‌ها:*\n${orderBreakdown}\n` +
        `💡 _تمامی ترتیب‌های گذشته با موفقیت بازسازی و ثبت شده‌اند._`;

    const keyboard = {
        inline_keyboard: [
            [
                { text: "📥 دریافت فایل این داده‌ها (CSV)", callback_data: "export_csv_all" },
                { text: "📈 مقایسه نمرات دستگاه‌ها", callback_data: "menu_thesis_metrics" }
            ],
            [
                { text: "🔙 بازگشت به منوی اصلی", callback_data: "menu_main" }
            ]
        ]
    };

    return sendTelegramMsg(botToken, chatId, text, keyboard, "Markdown");
}

async function showDateRangeMenu(botToken, chatId) {
    const text = 
        "📅 *انتخاب بازه زمانی برای دریافت داده‌ها و خروجی اکسل/CSV*\n\n" +
        "بازه زمانی مورد نظر خود را جهت فیلتر و صدور گزارش انتخاب کنید:";

    const keyboard = {
        inline_keyboard: [
            [
                { text: "⚡ امروز (۲۴ ساعت اخیر)", callback_data: "filter_date_today" },
                { text: "🕒 ۳ روز اخیر", callback_data: "filter_date_3days" }
            ],
            [
                { text: "🗓 یک هفته اخیر", callback_data: "filter_date_7days" },
                { text: "📆 یک ماه اخیر", callback_data: "filter_date_30days" }
            ],
            [
                { text: "🌐 کل داده‌های ثبت شده (همه زمان‌ها)", callback_data: "filter_date_all" }
            ],
            [
                { text: "🔙 بازگشت به منو", callback_data: "menu_main" }
            ]
        ]
    };

    return sendTelegramMsg(botToken, chatId, text, keyboard, "Markdown");
}

async function showDateSelectedMenu(botToken, chatId, preset) {
    const data = await fetchBackendData();
    const filtered = filterByDatePreset(data, preset);

    const labels = {
        today: "امروز",
        '3days': "۳ روز اخیر",
        '7days': "یک هفته اخیر",
        '30days': "یک ماه اخیر",
        all: "کل داده‌ها"
    };

    const text = 
        `✅ *بازه انتخابی: ${labels[preset] || preset}*\n\n` +
        `📌 *تعداد رکورد در این بازه:* ${filtered.length} پاسخ‌نامه\n\n` +
        `نوع خروجی مورد نظر خود را انتخاب کنید:`;

    const keyboard = {
        inline_keyboard: [
            [
                { text: "📁 دانلود CSV کامل (با ستون ترتیب)", callback_data: `export_csv_${preset}` }
            ],
            [
                { text: "👤 فقط اطلاعات دموگرافیک", callback_data: `export_demo_${preset}` },
                { text: "⭐ فقط نمرات VAS و زیبایی", callback_data: `export_vas_${preset}` }
            ],
            [
                { text: "📅 انتخاب بازه دیگر", callback_data: "menu_daterange" },
                { text: "🔙 منوی اصلی", callback_data: "menu_main" }
            ]
        ]
    };

    return sendTelegramMsg(botToken, chatId, text, keyboard, "Markdown");
}

async function sendExportCSV(botToken, chatId, preset, fieldFilter) {
    await sendTelegramMsg(botToken, chatId, "⏳ در حال ساخت فایل CSV با ستون‌های ترتیب و متغیرها...");

    const raw = await fetchBackendData();
    const filtered = filterByDatePreset(raw, preset);

    if (filtered.length === 0) {
        return sendTelegramMsg(botToken, chatId, "⚠️ هیچ داده‌ای در این بازه زمانی یافت نشد.");
    }

    const csvContent = generateCSV(filtered, fieldFilter);
    const dateTag = new Date().toISOString().slice(0, 10);
    const fileName = `thesis_survey_${preset}_${fieldFilter}_${dateTag}.csv`;
    const caption = `📁 خروجی داده‌های پژوهش\nبازه: ${preset} | فیلدها: ${fieldFilter}\nتعداد رکورد: ${filtered.length}`;

    await sendTelegramDoc(botToken, chatId, csvContent, fileName, caption);
    return showMainMenu(botToken, chatId, "فایل با موفقیت ارسال شد. عملیات بعدی:");
}

async function showThesisComparison(botToken, chatId) {
    const data = await fetchBackendData();
    if (data.length === 0) {
        return sendTelegramMsg(botToken, chatId, "⚠️ داده‌ای برای محاسبه وجود ندارد.");
    }

    // Compute key metrics across Aligner, Ceramic, Metal
    const metrics = [
        { label: "جذابیت کلی (VAS)", key: "overall" },
        { label: "جلب توجه / دیده شدن", key: "distract" },
        { label: "تناسب با محیط کار", key: "prof" },
        { label: "خجالت / عدم راحتی", key: "work" },
        { label: "درک هوش فرد", key: "intel" },
        { label: "درک بهداشت دهان", key: "hygiene" }
    ];

    let report = "📈 *مقایسه میانگین و انحراف معیار دستگاه‌ها (آماده تز)*\n\n";
    report += "معیار: `میانگین ± انحراف معیار`\n";
    report += "━━━━━━━━━━━━━━━━━━━━\n";

    for (const m of metrics) {
        report += `📌 *${m.label}:*\n`;
        for (const app of ['aligner', 'ceramic', 'metal']) {
            const vals = data.map(r => r[`vas_${app}_${m.key}`] || r[`psy_${app}_${m.key}`] || r[`acc_${app}_${m.key}`]).filter(Boolean);
            const stats = calcMeanSD(vals);
            const faName = APPLIANCE_FA_MAP[app];
            report += `  • ${faName}: \`${stats.mean} ± ${stats.sd}\`\n`;
        }
        report += "\n";
    }

    const keyboard = {
        inline_keyboard: [
            [
                { text: "🔄 بررسی اثر ترتیب بر نمرات", callback_data: "menu_order_bias" },
                { text: "📥 دریافت فایل CSV کامل", callback_data: "export_csv_all" }
            ],
            [
                { text: "🔙 بازگشت به منوی اصلی", callback_data: "menu_main" }
            ]
        ]
    };

    return sendTelegramMsg(botToken, chatId, report, keyboard, "Markdown");
}

async function showOrderBiasAnalysis(botToken, chatId) {
    const data = await fetchBackendData();
    if (data.length === 0) {
        return sendTelegramMsg(botToken, chatId, "⚠️ داده‌ای برای محاسبه وجود ندارد.");
    }

    let report = "🔄 *بررسی اثر تقدم و تأخر (Order Effect / Bias)*\n\n";
    report += "میانگین جذابیت کلی لبخند (VAS Overall) بر حسب اینکه دستگاه در چه نوبتی دیده شده است:\n";
    report += "━━━━━━━━━━━━━━━━━━━━\n\n";

    for (const app of ['aligner', 'ceramic', 'metal']) {
        const faName = APPLIANCE_FA_MAP[app];
        const vasKey = `vas_${app}_overall`;

        const pos1Vals = data.filter(r => r.first_appliance === app).map(r => r[vasKey]).filter(Boolean);
        const pos2Vals = data.filter(r => r.second_appliance === app).map(r => r[vasKey]).filter(Boolean);
        const pos3Vals = data.filter(r => r.third_appliance === app).map(r => r[vasKey]).filter(Boolean);

        const s1 = calcMeanSD(pos1Vals);
        const s2 = calcMeanSD(pos2Vals);
        const s3 = calcMeanSD(pos3Vals);

        report += `🦷 *${faName}:*\n`;
        report += `  ۱️⃣ وقتی اول دیده شد (N=${s1.count}): \`${s1.mean} ± ${s1.sd}\`\n`;
        report += `  ۲️⃣ وقتی دوم دیده شد (N=${s2.count}): \`${s2.mean} ± ${s2.sd}\`\n`;
        report += `  ۳️⃣ وقتی سوم دیده شد (N=${s3.count}): \`${s3.mean} ± ${s3.sd}\`\n\n`;
    }

    report += "💡 _این جدول نشان می‌دهد آیا رندوم‌سازی ترتیب توانسته اثر سوگیری پاسخ‌دهی را خنثی کند یا خیر._";

    const keyboard = {
        inline_keyboard: [
            [
                { text: "📊 مقایسه کلی دستگاه‌ها", callback_data: "menu_thesis_metrics" },
                { text: "📥 دریافت فایل CSV کامل", callback_data: "export_csv_all" }
            ],
            [
                { text: "🔙 بازگشت به منوی اصلی", callback_data: "menu_main" }
            ]
        ]
    };

    return sendTelegramMsg(botToken, chatId, report, keyboard, "Markdown");
}