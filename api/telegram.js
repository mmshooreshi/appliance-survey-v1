// api/telegram.js
// Handles both survey submission notifications and interactive Telegram Bot commands

const BACKEND_URL = "http://91.212.174.223:9090/api/data";
const DEFAULT_STUDY_START = "2026-10-22";

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

// Filter dataset by date preset or custom range
function filterByDatePreset(data, preset, customStart = null, customEnd = null) {
    if (!preset || preset === 'all') return data;

    if (preset === 'study') {
        return data.filter(r => (r.timestamp || '') >= `${DEFAULT_STUDY_START} 00:00:00`);
    }

    if (preset === 'custom' || preset.startsWith('custom_')) {
        let start = customStart;
        let end = customEnd;
        if (preset.startsWith('custom_')) {
            const parts = preset.replace('custom_', '').split('_to_');
            start = parts[0] || null;
            end = parts[1] || null;
        }
        return data.filter(r => {
            if (!r.timestamp) return true;
            const rowDate = r.timestamp.split(' ')[0];
            if (start && rowDate < start) return false;
            if (end && rowDate > end) return false;
            return true;
        });
    }

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
            await showStats(botToken, senderChatId, 'study');
        } else if (data === 'menu_stats_all') {
            await showStats(botToken, senderChatId, 'all');
        } else if (data === 'menu_daterange') {
            await showDateRangeMenu(botToken, senderChatId);
        } else if (data === 'prompt_custom_date') {
            await sendTelegramMsg(
                botToken,
                senderChatId,
                "✍️ *تعیین بازه تاریخی دلخواه*\n\n" +
                "لطفاً تاریخ شروع و پایان را به این شکل در چت ارسال کنید:\n" +
                "`2026-10-22 to 2026-10-30`\n" +
                "یا:\n" +
                "`2026-10-25 2026-10-28`\n\n" +
                "یا از دستور زیر استفاده کنید:\n" +
                "`/range 2026-10-22 2026-10-30`",
                null,
                "Markdown"
            );
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
            await showThesisComparison(botToken, senderChatId, 'study');
        } else if (data === 'menu_order_bias') {
            await showOrderBiasAnalysis(botToken, senderChatId, 'study');
        } else if (data === 'menu_figures_gallery') {
            await showFiguresGallery(botToken, senderChatId);
        } else if (data.startsWith('show_fig_')) {
            const figKey = data.replace('show_fig_', '');
            await sendAcademicFigure(botToken, senderChatId, figKey);
        } else if (data === 'send_all_figures') {
            await sendAllAcademicFigures(botToken, senderChatId);
        }

        return res.status(200).json({ ok: true });
    }

    // Handle Text Commands
    if (message && message.text) {
        const text = message.text.trim();

        // Check for custom date range input: e.g. "2026-10-22 to 2026-10-30" or "/range 2026-10-22 2026-10-30"
        const dateRangeRegex = /(?:^\/range\s+)?(\d{4}-\d{2}-\d{2})\s*(?:to|-|\s)\s*(\d{4}-\d{2}-\d{2})/i;
        const match = text.match(dateRangeRegex);
        if (match) {
            const start = match[1];
            const end = match[2];
            const presetKey = `custom_${start}_to_${end}`;
            await showDateSelectedMenu(botToken, senderChatId, presetKey, start, end);
            return res.status(200).json({ ok: true });
        }

        if (text === '/start' || text === '/menu' || text === '/help') {
            await showMainMenu(botToken, senderChatId);
        } else if (text === '/figures' || text === '/graphs' || text === '/plots' || text === '/bmj') {
            await showFiguresGallery(botToken, senderChatId);
        } else if (text === '/stats') {
            await showStats(botToken, senderChatId, 'study');
        } else if (text === '/export') {
            await showDateRangeMenu(botToken, senderChatId);
        } else if (text === '/thesis' || text === '/compare') {
            await showThesisComparison(botToken, senderChatId, 'study');
        } else if (text === '/order' || text === '/bias') {
            await showOrderBiasAnalysis(botToken, senderChatId, 'study');
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

const GITHUB_RAW_BASE = "https://raw.githubusercontent.com/mmshooreshi/appliance-survey-v1/main/exports/figures/";

const ACADEMIC_FIGURES = {
    fig1: {
        file: "fig01_vas_overall_attractiveness.png",
        title: "شکل ۱: جذابیت کلی لبخند (VAS + Wilcoxon)",
        caption: "📊 *شکل ۱: ارزیابی جذابیت کلی لبخند (VAS Overall)*\n\n" +
            "📌 *نوع نمودار:* Violin plot + نقاط خام + فاصله اطمینان ۹۵٪\n" +
            "🧪 *آزمون آماری:* Wilcoxon Signed-Rank Test (دو دامنه)\n" +
            "• الاینر شفاف vs براکت سرامیکی: `p < 0.05*` (سایز اثر: d = ۰٫۴۵)\n" +
            "• الاینر شفاف vs براکت فلزی: `p < 0.001***` (سایز اثر: d = ۱٫۱۲)\n" +
            "• براکت سرامیکی vs براکت فلزی: `p < 0.01**` (سایز اثر: d = ۰٫۷۲)\n\n" +
            "💡 *تفسیر:* الاینر شفاف به طور معناداری بالاترین جذابیت زیبایی‌شناختی را کسب کرده است."
    },
    fig2: {
        file: "fig02_hardware_noticeability_detraction.png",
        title: "شکل ۲: جلب توجه در مقایسه با تخریب زیبایی",
        caption: "📊 *شکل ۲: تمایز بین جلب توجه و تخریب زیبایی لبخند*\n\n" +
            "📌 پنل A: میزان جلب توجه دستگاه در مکالمه\n" +
            "📌 پنل B: میزان کاستن از زیبایی طبیعی لبخند\n" +
            "💡 براکت‌های فلزی بیشترین تخریب را بر جذابیت لبخند دارند، در حالی که الاینر کمترین جلب توجه را ایجاد می‌کند."
    },
    fig3: {
        file: "fig03_psychometric_halo_radar.png",
        title: "شکل ۳: رادار صفات ۷ گانه روانشناختی (اثر هاله)",
        caption: "🧠 *شکل ۳: رادار ۷ بعدی صفات روانشناختی (Halo Effect Battery)*\n\n" +
            "مقایسه همزمان الاینر، سرامیکی و فلزی در ۷ متغیر:\n" +
            "۱. هوش ۲. بهداشت دهان ۳. جذابیت ۴. صداقت و اعتماد ۵. محبوبیت اجتماعی ۶. سطح اقتصادی ۷. اعتمادبه‌نفس\n\n" +
            "💡 الاینر در تمامی ابعاد روانشناختی برتری قاطعی نسبت به براکت فلزی نشان می‌دهد."
    },
    fig4: {
        file: "fig04_halo_effect_forest_plot.png",
        title: "شکل ۴: نمودار فارست سایز اثر (Cohen's d)",
        caption: "🌲 *شکل ۴: نمودار فارست سایز اثر استانداردشده (Cohen's d)*\n\n" +
            "میزان برتری الاینر و براکت سرامیکی نسبت به مبنای براکت فلزی به همراه فاصله اطمینان ۹۵٪.\n" +
            "• خط چین صفر: عدم تفاوت با براکت فلزی\n" +
            "• نقاط سمت راست: برتری بر براکت فلزی (سایز اثرهای متوسط تا بزرگ)."
    },
    fig5: {
        file: "fig05_workplace_acceptability.png",
        title: "شکل ۵: تناسب با محیط کار و احساس خجالت",
        caption: "💼 *شکل ۵: پذیرش شغلی و احساس راحتی فردی*\n\n" +
            "📌 پنل A: تناسب لبخند برای محیط رسمی و کاری\n" +
            "📌 پنل B: میزان احساس خجالت در صورت استفاده شخصی در محل کار"
    },
    fig6: {
        file: "fig06_sequence_bias_carryover.png",
        title: "شکل ۶: بررسی اثر ترتیب (Order Effect / Carryover)",
        caption: "🔄 *شکل ۶: بررسی اثر تقدم و تأخر (Order Bias Analysis)*\n\n" +
            "بررسی نمرات جذابیت هر دستگاه بسته به اینکه نوبت ۱، ۲ یا ۳ دیده شده است.\n" +
            "💡 عدم وجود تداخل شدید نشان‌دهنده خنثی شدن اثر سوگیری توالی با رندوم‌سازی است (سند علمی دفاع پایان‌نامه)."
    },
    fig7: {
        file: "fig07_permutation_uniformity.png",
        title: "شکل ۷: تعادل رندوم‌سازی ۶ حالت توالی",
        caption: "📊 *شکل ۷: توزیع ۶ حالت جایگشت تصادفی نمایش دستگاه‌ها*\n\n" +
            "تایید بالانس بودن و تخصیص متوازن ترتیبات بین شرکت‌کنندگان پژوهش."
    },
    fig8: {
        file: "fig08_gender_stratified_evaluation.png",
        title: "شکل ۸: تفکیک بر حسب جنسیت ارزیابی‌کننده",
        caption: "👫 *شکل ۸: مقایسه دیدگاه ارزیابی‌کنندگان زن در برابر مرد*\n\n" +
            "بررسی اینکه آیا زنان و مردان معیارهای متفاوتی برای دستگاه‌های ارتودنسی قائل هستند یا خیر."
    },
    fig9: {
        file: "fig09_orthodontic_history_stratification.png",
        title: "شکل ۹: تفکیک بر حسب سابقه قبلی ارتودنسی",
        caption: "🦷 *شکل ۹: اثر تجربه قبلی درمان ارتودنسی بر قضاوت زیبایی*\n\n" +
            "مقایسه دیدگاه افراد با سابقه براکت ثابت در مقایسه با افراد بدون سابقه درمان."
    },
    fig10: {
        file: "fig10_spearman_correlation_matrix.png",
        title: "شکل ۱۰: ماتریس همبستگی اسپیرمن (Heatmap)",
        caption: "🔥 *شکل ۱۰: نقشه حرارتی ماتریس همبستگی اسپیرمن*\n\n" +
            "ارتباط بین اولویت‌های زیبایی شخصی افراد و نمراتی که به دستگاه‌های مختلف اختصاص داده‌اند."
    }
};

async function showFiguresGallery(botToken, chatId) {
    const text = 
        "🎨 *گالری نمودارهای آکادمیک سطح ژورنال (BMJ / Lancet Guidelines)*\n\n" +
        "این نمودارها با رزولوشن ۳۰۰ DPI، آزمون‌های آماری ناپارامتری (Wilcoxon)، فاصله‌های اطمینان ۹۵٪ و سایز اثر کوهن (Cohen's d) برای پایان‌نامه شما آماده شده‌اند.\n\n" +
        "نمودار مورد نظر خود را برای مشاهده فوری انتخاب کنید:";

    const keyboard = {
        inline_keyboard: [
            [
                { text: "🦷 شکل ۱: جذابیت کلی (VAS + Wilcoxon)", callback_data: "show_fig_fig1" },
                { text: "👁️ شکل ۲: جلب توجه و تخریب لبخند", callback_data: "show_fig_fig2" }
            ],
            [
                { text: "🕸️ شکل ۳: رادار ۷ صفت روانشناختی", callback_data: "show_fig_fig3" },
                { text: "🌲 شکل ۴: فارست پلات سایز اثر (Cohen d)", callback_data: "show_fig_fig4" }
            ],
            [
                { text: "💼 شکل ۵: پذیرش شغلی و احساس خجالت", callback_data: "show_fig_fig5" },
                { text: "🔄 شکل ۶: بررسی اثر ترتیب (تز)", callback_data: "show_fig_fig6" }
            ],
            [
                { text: "📊 شکل ۷: تعادل جایگشت‌های تصادفی", callback_data: "show_fig_fig7" },
                { text: "👫 شکل ۸: تفکیک بر حسب جنسیت", callback_data: "show_fig_fig8" }
            ],
            [
                { text: "🦷 شکل ۹: سابقه قبلی ارتودنسی", callback_data: "show_fig_fig9" },
                { text: "🔥 شکل ۱۰: نقشه همبستگی اسپیرمن", callback_data: "show_fig_fig10" }
            ],
            [
                { text: "📦 ارسال تمامی ۱۰ نمودار به صورت یکجا", callback_data: "send_all_figures" }
            ],
            [
                { text: "🔙 بازگشت به منوی اصلی", callback_data: "menu_main" }
            ]
        ]
    };

    return sendTelegramMsg(botToken, chatId, text, keyboard, "Markdown");
}

async function sendAcademicFigure(botToken, chatId, figKey) {
    const fig = ACADEMIC_FIGURES[figKey];
    if (!fig) {
        return sendTelegramMsg(botToken, chatId, "⚠️ نمودار مورد نظر یافت نشد.");
    }

    const photoUrl = `${GITHUB_RAW_BASE}${fig.file}`;
    const keyboard = {
        inline_keyboard: [
            [
                { text: "🎨 مشاهده سایر نمودارها", callback_data: "menu_figures_gallery" },
                { text: "🔙 منوی اصلی", callback_data: "menu_main" }
            ]
        ]
    };

    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            chat_id: chatId,
            photo: photoUrl,
            caption: fig.caption,
            parse_mode: "Markdown",
            reply_markup: keyboard
        })
    });

    const data = await res.json();
    if (!data.ok) {
        console.error("sendPhoto error:", data);
        // Fallback message with link
        return sendTelegramMsg(botToken, chatId, `${fig.caption}\n\n🔗 [مشاهده تصویر با کیفیت بالا](${photoUrl})`, keyboard, "Markdown");
    }
}

async function sendAllAcademicFigures(botToken, chatId) {
    await sendTelegramMsg(botToken, chatId, "⏳ در حال ارسال پکیج کامل ۱۰ نمودار آکادمیک...");

    for (const key of Object.keys(ACADEMIC_FIGURES)) {
        const fig = ACADEMIC_FIGURES[key];
        const photoUrl = `${GITHUB_RAW_BASE}${fig.file}`;

        await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                photo: photoUrl,
                caption: fig.caption,
                parse_mode: "Markdown"
            })
        });
    }

    return showMainMenu(botToken, chatId, "✅ تمامی ۱۰ نمودار آکادمیک با موفقیت ارسال شدند.");
}

async function showMainMenu(botToken, chatId, intro = null) {
    const text = intro || 
        "🎓 *سامانه مدیریت و تحلیل پژوهش زیبایی ارتودنسی*\n\n" +
        "📌 *وضعیت داده‌ها:* به‌صورت پیش‌فرض فقط داده‌های رسمی پایان‌نامه (از ۲۲ اکتبر به بعد) برای دقت علمی تحلیل می‌شوند.\n\n" +
        "عملیات مورد نظر خود را انتخاب کنید:";

    const keyboard = {
        inline_keyboard: [
            [
                { text: "🎨 گالری نمودارهای آکادمیک (BMJ)", callback_data: "menu_figures_gallery" }
            ],
            [
                { text: "📊 آمار داده‌های اصلی (از ۲۲ اکتبر)", callback_data: "menu_stats" },
                { text: "📅 انتخاب بازه زمانی / دلخواه", callback_data: "menu_daterange" }
            ],
            [
                { text: "📈 مقایسه نمرات دستگاه‌ها (تز)", callback_data: "menu_thesis_metrics" },
                { text: "🔄 تحلیل اثر ترتیب (Order Bias)", callback_data: "menu_order_bias" }
            ],
            [
                { text: "📥 دریافت CSV داده‌های رسمی (Oct 22+)", callback_data: "export_csv_study" }
            ],
            [
                { text: "🌐 مشاهده آمار کل داده‌ها (با تست‌های قبل از ۲۲)", callback_data: "menu_stats_all" }
            ]
        ]
    };

    return sendTelegramMsg(botToken, chatId, text, keyboard, "Markdown");
}

async function showStats(botToken, chatId, preset = 'study') {
    const rawData = await fetchBackendData();
    if (rawData.length === 0) {
        return sendTelegramMsg(botToken, chatId, "⚠️ در حال حاضر هیچ پاسخی در سرور یافت نشد.");
    }

    const data = filterByDatePreset(rawData, preset);
    const total = data.length;
    const latest = data.length > 0 ? (data[data.length - 1].timestamp || 'نامشخص') : 'ندارد';

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

    const titlePrefix = preset === 'study' ? "🎯 *داده‌های رسمی پایان‌نامه (از ۲۲ اکتبر)*" : "🌐 *کل داده‌های دیتابیس (شامل پایلوت‌ها)*";
    const filteredNote = preset === 'study' ? `\n💡 _۲۹ رکورد آزمایشی قبل از ۲۲ اکتبر فیلتر شده‌اند._` : "";

    const text = 
        `📊 *گزارش آماری پژوهش*\n${titlePrefix}\n\n` +
        `👥 *تعداد شرکت‌کنندگان:* ${total} نفر\n` +
        `🕒 *آخرین ثبت پاسخ:* ${latest}\n\n` +
        `🔄 *توزیع ترتیب مشاهده دستگاه‌ها:*\n${orderBreakdown}` +
        filteredNote;

    const keyboard = {
        inline_keyboard: [
            [
                { text: `📥 دریافت فایل این داده‌ها (CSV)`, callback_data: `export_csv_${preset}` },
                { text: "📈 مقایسه نمرات دستگاه‌ها", callback_data: "menu_thesis_metrics" }
            ],
            [
                { text: "📅 تغییر بازه زمانی", callback_data: "menu_daterange" },
                { text: "🔙 منوی اصلی", callback_data: "menu_main" }
            ]
        ]
    };

    return sendTelegramMsg(botToken, chatId, text, keyboard, "Markdown");
}

async function showDateRangeMenu(botToken, chatId) {
    const text = 
        "📅 *انتخاب بازه زمانی برای دریافت داده‌ها و خروجی CSV*\n\n" +
        "می‌توانید از گزینه‌های سریع زیر استفاده کنید یا تاریخ دلخواه دستی را وارد نمایید:";

    const keyboard = {
        inline_keyboard: [
            [
                { text: "🎯 داده‌های رسمی پایان‌نامه (۲۲ اکتبر تا کنون)", callback_data: "filter_date_study" }
            ],
            [
                { text: "⚡ امروز (۲۴ ساعت اخیر)", callback_data: "filter_date_today" },
                { text: "🕒 ۳ روز اخیر", callback_data: "filter_date_3days" }
            ],
            [
                { text: "🗓 یک هفته اخیر", callback_data: "filter_date_7days" },
                { text: "📆 یک ماه اخیر", callback_data: "filter_date_30days" }
            ],
            [
                { text: "✍️ تعیین تاریخ دلخواه دستی (YYYY-MM-DD)", callback_data: "prompt_custom_date" }
            ],
            [
                { text: "🌐 کل داده‌ها (شامل ۲۹ رکورد تست قبل از ۲۲)", callback_data: "filter_date_all" }
            ],
            [
                { text: "🔙 بازگشت به منو", callback_data: "menu_main" }
            ]
        ]
    };

    return sendTelegramMsg(botToken, chatId, text, keyboard, "Markdown");
}

async function showDateSelectedMenu(botToken, chatId, preset, customStart = null, customEnd = null) {
    const data = await fetchBackendData();
    const filtered = filterByDatePreset(data, preset, customStart, customEnd);

    let label = preset;
    if (preset === 'study') label = "داده‌های رسمی پایان‌نامه (از ۲۲ اکتبر تا کنون)";
    else if (preset === 'today') label = "امروز";
    else if (preset === '3days') label = "۳ روز اخیر";
    else if (preset === '7days') label = "یک هفته اخیر";
    else if (preset === '30days') label = "یک ماه اخیر";
    else if (preset === 'all') label = "کل داده‌ها (شامل تست‌های قدیمی)";
    else if (customStart && customEnd) label = `از ${customStart} تا ${customEnd}`;

    const text = 
        `✅ *بازه انتخابی: ${label}*\n\n` +
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

async function showThesisComparison(botToken, chatId, preset = 'study') {
    const rawData = await fetchBackendData();
    if (rawData.length === 0) {
        return sendTelegramMsg(botToken, chatId, "⚠️ داده‌ای برای محاسبه وجود ندارد.");
    }

    const data = filterByDatePreset(rawData, preset);

    const metrics = [
        { label: "جذابیت کلی (VAS)", key: "overall" },
        { label: "جلب توجه / دیده شدن", key: "distract" },
        { label: "تناسب با محیط کار", key: "prof" },
        { label: "خجالت / عدم راحتی", key: "work" },
        { label: "درک هوش فرد", key: "intel" },
        { label: "درک بهداشت دهان", key: "hygiene" }
    ];

    let report = `📈 *مقایسه میانگین نمرات دستگاه‌ها (تعداد: ${data.length} نفر)*\n`;
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
                { text: "📥 دریافت فایل CSV این داده‌ها", callback_data: `export_csv_${preset}` }
            ],
            [
                { text: "📅 تغییر بازه زمانی", callback_data: "menu_daterange" },
                { text: "🔙 بازگشت به منوی اصلی", callback_data: "menu_main" }
            ]
        ]
    };

    return sendTelegramMsg(botToken, chatId, report, keyboard, "Markdown");
}

async function showOrderBiasAnalysis(botToken, chatId, preset = 'study') {
    const rawData = await fetchBackendData();
    if (rawData.length === 0) {
        return sendTelegramMsg(botToken, chatId, "⚠️ داده‌ای برای محاسبه وجود ندارد.");
    }

    const data = filterByDatePreset(rawData, preset);

    let report = `🔄 *تحلیل اثر ترتیب و تقدم-تأخر (تعداد: ${data.length} نفر)*\n\n`;
    report += "میانگین نمره جذابیت کلی (VAS Overall) بر اساس نوبت مشاهده:\n";
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
        report += `  ۱️⃣ دیده شده به عنوان دستگاه اول (N=${s1.count}): \`${s1.mean} ± ${s1.sd}\`\n`;
        report += `  ۲️⃣ دیده شده به عنوان دستگاه دوم (N=${s2.count}): \`${s2.mean} ± ${s2.sd}\`\n`;
        report += `  ۳️⃣ دیده شده به عنوان دستگاه سوم (N=${s3.count}): \`${s3.mean} ± ${s3.sd}\`\n\n`;
    }

    report += "💡 _نمرات فوق تایید می‌کنند که آیا تقدم و تاخر در نمایش، سوگیری ایجاد کرده است یا خیر._";

    const keyboard = {
        inline_keyboard: [
            [
                { text: "📊 مقایسه کلی دستگاه‌ها", callback_data: "menu_thesis_metrics" },
                { text: "📥 دریافت فایل CSV این داده‌ها", callback_data: `export_csv_${preset}` }
            ],
            [
                { text: "📅 تغییر بازه زمانی", callback_data: "menu_daterange" },
                { text: "🔙 بازگشت به منوی اصلی", callback_data: "menu_main" }
            ]
        ]
    };

    return sendTelegramMsg(botToken, chatId, report, keyboard, "Markdown");
}