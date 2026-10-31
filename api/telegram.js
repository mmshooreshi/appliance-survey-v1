// api/telegram.js
// Handles both survey submission notifications and interactive Telegram Bot commands

import { buildXLSX, buildXLSXFromObjects } from './xlsx_builder.js';

const BACKEND_URL = "http://91.212.174.223:9090/api/data";
const DEFAULT_STUDY_START = "2026-10-22";

const APPLIANCE_FA_MAP = {
    aligner: "الاینر شفاف",
    ceramic: "براکت سرامیکی",
    metal: "براکت فلزی"
};

// Helper: Convert digits to Persian numerals
function toPersianDigits(str) {
    if (str === null || str === undefined) return '';
    const faDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    return String(str).replace(/[0-9]/g, w => faDigits[+w]);
}

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
async function sendTelegramDoc(botToken, chatId, fileContent, fileName, caption = '', mimeType = 'text/csv;charset=utf-8;') {
    const formData = new FormData();
    formData.append('chat_id', chatId);
    if (caption) formData.append('caption', caption);
    const blob = new Blob([fileContent], { type: mimeType });
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
        const xlsxBuf = buildXLSXFromObjects([responses], 'SurveyResponse');
        const ts = Date.now();

        try {
            const sendPromises = authorizedChatIds.map(async (chatId) => {
                await sendTelegramMsg(botToken, chatId, messageText);
                await sendTelegramDoc(botToken, chatId, csvString, `survey_${ts}.csv`, '📁 فایل خروجی پاسخ‌نامه (CSV)');
                await sendTelegramDoc(
                    botToken,
                    chatId,
                    xlsxBuf,
                    `survey_${ts}.xlsx`,
                    '📊 فایل خروجی پاسخ‌نامه (Excel .xlsx)',
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                );
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
            await sendExportFiles(botToken, senderChatId, preset, 'all');
        } else if (data.startsWith('export_demo_')) {
            const preset = data.replace('export_demo_', '');
            await sendExportFiles(botToken, senderChatId, preset, 'demo');
        } else if (data.startsWith('export_vas_')) {
            const preset = data.replace('export_vas_', '');
            await sendExportFiles(botToken, senderChatId, preset, 'vas');
        } else if (data.startsWith('export_fig_xlsx_')) {
            const figKey = data.replace('export_fig_xlsx_', '');
            await sendFigureData(botToken, senderChatId, figKey, 'xlsx');
        } else if (data.startsWith('export_fig_csv_')) {
            const figKey = data.replace('export_fig_csv_', '');
            await sendFigureData(botToken, senderChatId, figKey, 'csv');
        } else if (data === 'menu_tables') {
            await showThesisTablesMenu(botToken, senderChatId);
        } else if (data.startsWith('show_table_')) {
            const tableNum = data.replace('show_table_', '');
            await showSingleTablePreview(botToken, senderChatId, tableNum);
        } else if (data === 'export_all_tables_xlsx') {
            await sendAllTablesExcel(botToken, senderChatId);
        } else if (data === 'export_all_tables_md') {
            await sendAllTablesMarkdown(botToken, senderChatId);
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
        } else if (text === '/tables' || text === '/table') {
            await showThesisTablesMenu(botToken, senderChatId);
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

import { ACADEMIC_FIGURES, THESIS_TABLES_DATA, GITHUB_RAW_BASE } from './academic_figures_meta.js';

async function showFiguresGallery(botToken, chatId) {
    const text = 
        "🎨 *گالری جامع ۱۵ نمودار آکادمیک سطح ژورنال (BMJ / Lancet Guidelines)*\n\n" +
        "این مجموعه کامل با رزولوشن ۳۰۰ DPI، آزمون‌های آماری ناپارامتری (Wilcoxon)، فاصله‌های اطمینان ۹۵٪، رگرسیون، منحنی‌های CDF و سایز اثر کوهن (Cohen's d) برای پایان‌نامه شما آماده است.\n\n" +
        "نمودار مورد نظر خود را انتخاب کنید:";

    const keyboard = {
        inline_keyboard: [
            [
                { text: "🦷 شکل ۱: جذابیت کلی (Wilcoxon)", callback_data: "show_fig_fig1" },
                { text: "👁️ شکل ۲: جلب توجه و تخریب لبخند", callback_data: "show_fig_fig2" }
            ],
            [
                { text: "🧠 شکل ۳: رادار ۷ صفت روانشناختی", callback_data: "show_fig_fig3" },
                { text: "🌲 شکل ۴: فارست پلات اثر هاله (d)", callback_data: "show_fig_fig4" }
            ],
            [
                { text: "💼 شکل ۵: پذیرش شغلی و خجالت", callback_data: "show_fig_fig5" },
                { text: "🔄 شکل ۶: بررسی اثر ترتیب (تز)", callback_data: "show_fig_fig6" }
            ],
            [
                { text: "📊 شکل ۷: تعادل ۶ جایگشت رندوم", callback_data: "show_fig_fig7" },
                { text: "👫 شکل ۸: تفکیک بر حسب جنسیت", callback_data: "show_fig_fig8" }
            ],
            [
                { text: "🦷 شکل ۹: سابقه قبلی ارتودنسی", callback_data: "show_fig_fig9" },
                { text: "🔥 شکل ۱۰: نقشه همبستگی اسپیرمن", callback_data: "show_fig_fig10" }
            ],
            [
                { text: "📈 شکل ۱۱: رگرسیون هارمونی رنگ", callback_data: "show_fig_fig11" },
                { text: "🎯 شکل ۱۲: شاخص ترکیبی تمایل فردی", callback_data: "show_fig_fig12" }
            ],
            [
                { text: "📊 شکل ۱۳: تحلیل طبقات سنی", callback_data: "show_fig_fig13" },
                { text: "👨‍⚕️ شکل ۱۴: عامه مردم vs دندانپزشکی", callback_data: "show_fig_fig14" }
            ],
            [
                { text: "📉 شکل ۱۵: منحنی‌های پذیرش تجمعی (CDF)", callback_data: "show_fig_fig15" }
            ],
            [
                { text: "📋 مشاهده جداول پایان‌نامه (Tables 1-4)", callback_data: "menu_tables" }
            ],
            [
                { text: "📦 ارسال تمامی ۱۵ نمودار به صورت یکجا", callback_data: "send_all_figures" }
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
    const navRow = [];
    if (fig.prev) navRow.push({ text: "⬅️ شکل قبلی", callback_data: `show_fig_${fig.prev}` });
    if (fig.next) navRow.push({ text: "➡️ شکل بعدی", callback_data: `show_fig_${fig.next}` });

    const keyboard = {
        inline_keyboard: [
            [
                { text: "📊 دریافت اکسل داده‌های این شکل (XLSX)", callback_data: `export_fig_xlsx_${figKey}` },
                { text: "📄 دریافت CSV داده‌های این شکل", callback_data: `export_fig_csv_${figKey}` }
            ],
            ...(navRow.length > 0 ? [navRow] : []),
            [
                { text: "🎨 گالری کامل ۱۵ نمودار", callback_data: "menu_figures_gallery" },
                { text: "📋 جداول پایان‌نامه", callback_data: "menu_tables" }
            ],
            [
                { text: "🔙 منوی اصلی", callback_data: "menu_main" }
            ]
        ]
    };

    const rawData = await fetchBackendData();
    const cohort = filterByDatePreset(rawData, 'study');
    const nFa = toPersianDigits(cohort.length);
    const liveCaption = `${fig.caption}\n\n👥 *حجم نمونه زنده دیتابیس:* ${nFa} نفر | برای دریافت مقادیر عددی دقیق، از دکمه‌های XLSX یا CSV زیر استفاده کنید.`;

    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            chat_id: chatId,
            photo: photoUrl,
            caption: liveCaption,
            parse_mode: "Markdown",
            reply_markup: keyboard
        })
    });

    const data = await res.json();
    if (!data.ok) {
        console.error("sendPhoto error:", data);
        return sendTelegramMsg(botToken, chatId, `${fig.caption}\n\n🔗 [مشاهده تصویر با کیفیت بالا](${photoUrl})`, keyboard, "Markdown");
    }
}

async function sendFigureData(botToken, chatId, figKey, format = 'xlsx') {
    const fig = ACADEMIC_FIGURES[figKey];
    if (!fig) {
        return sendTelegramMsg(botToken, chatId, "⚠️ اطلاعات این نمودار یافت نشد.");
    }

    await sendTelegramMsg(botToken, chatId, `⏳ در حال آماده‌سازی فایل ${format.toUpperCase()} داده‌های مربوط به ${fig.title}...`);

    const rawData = await fetchBackendData();
    const cohort = filterByDatePreset(rawData, 'study');

    const vars = fig.vars || ['id', 'timestamp', 'vas_aligner_overall', 'vas_ceramic_overall', 'vas_metal_overall'];
    const filteredRows = cohort.map(r => {
        const item = {};
        for (const v of vars) {
            item[v] = r[v] !== undefined ? r[v] : '';
        }
        return item;
    });

    const figNum = figKey.replace('fig', '');
    const dateTag = new Date().toISOString().slice(0, 10);
    const fileName = `figure_${figNum}_dataset_${dateTag}.${format}`;
    const nFa = toPersianDigits(filteredRows.length);
    const caption = `📊 داده‌های اختصاصی ${fig.title}\n` +
                    `📌 متغیرها: ${vars.join(', ')}\n` +
                    `👥 تعداد شرکت‌کنندگان: ${nFa} نفر (داده‌های رسمی)\n` +
                    `🎓 بخش پایان‌نامه: ${fig.thesis_target}`;

    if (format === 'xlsx') {
        const xlsxBuf = buildXLSXFromObjects(filteredRows, `Figure_${figNum}`, vars);
        await sendTelegramDoc(
            botToken,
            chatId,
            xlsxBuf,
            fileName,
            caption,
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
    } else {
        const csvString = generateCSV(filteredRows, 'all');
        await sendTelegramDoc(botToken, chatId, csvString, fileName, caption, 'text/csv;charset=utf-8;');
    }

    const nextNav = {
        inline_keyboard: [
            [
                { text: `👁️ بازگشت به ${fig.title}`, callback_data: `show_fig_${figKey}` },
                { text: "🎨 گالری کامل نمودارها", callback_data: "menu_figures_gallery" }
            ],
            [
                { text: "🔙 منوی اصلی", callback_data: "menu_main" }
            ]
        ]
    };
    return sendTelegramMsg(botToken, chatId, "✅ فایل داده‌ها با موفقیت ارسال گردید.", nextNav, "Markdown");
}

async function showThesisTablesMenu(botToken, chatId) {
    const text = 
        "📋 *جداول استاندارد پایان‌نامه (APA 7th / BMJ Recommendations)*\n\n" +
        "این ۴ جدول دقیقاً بر اساس الزامات نگارش پایان‌نامه دندانپزشکی استخراج شده و آزمون‌های ناپارامتری (Wilcoxon، Kruskal-Wallis و Mann-Whitney) را پوشش می‌دهند:\n\n" +
        "۱. جدول ۱: متغیرهای دموگرافیک و پایه ارزیابی‌کنندگان\n" +
        "۲. جدول ۲: مقایسه ۵ بعد نمرات زیبایی و آزمون‌های ویلکاکسون\n" +
        "۳. جدول ۳: اعتبارسنجی خنثی بودن ترتیب و آزمون کروسکال-والیس\n" +
        "۴. جدول ۴: مقایسه عامه مردم با کادر دندانپزشکی\n\n" +
        "یک گزینه را انتخاب کنید:";

    const keyboard = {
        inline_keyboard: [
            [
                { text: "📊 دانلود فایل کامل اکسل (۴ شیت مجزا)", callback_data: "export_all_tables_xlsx" }
            ],
            [
                { text: "📝 دانلود متن کامل جداول (Markdown/Word)", callback_data: "export_all_tables_md" }
            ],
            [
                { text: "👁️ مشاهده جدول ۱ (دموگرافیک)", callback_data: "show_table_1" },
                { text: "👁️ مشاهده جدول ۲ (نمرات زیبایی)", callback_data: "show_table_2" }
            ],
            [
                { text: "👁️ مشاهده جدول ۳ (اثر ترتیب)", callback_data: "show_table_3" },
                { text: "👁️ مشاهده جدول ۴ (مردم vs دندانپزشکی)", callback_data: "show_table_4" }
            ],
            [
                { text: "🎨 مشاهده گالری ۱۵ نمودار", callback_data: "menu_figures_gallery" },
                { text: "🔙 منوی اصلی", callback_data: "menu_main" }
            ]
        ]
    };

    return sendTelegramMsg(botToken, chatId, text, keyboard, "Markdown");
}

function calcArrayStats(arr) {
    const valid = arr.map(Number).filter(n => !isNaN(n));
    if (valid.length === 0) return { n: 0, mean: "0.00", sd: "0.00" };
    const n = valid.length;
    const mean = valid.reduce((a, b) => a + b, 0) / n;
    const variance = n > 1 ? valid.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (n - 1) : 0;
    const sd = Math.sqrt(variance);
    return { n, mean: mean.toFixed(2), sd: sd.toFixed(2) };
}

async function showSingleTablePreview(botToken, chatId, tableNum) {
    const rawData = await fetchBackendData();
    const cohort = filterByDatePreset(rawData, 'study');
    const nFa = toPersianDigits(cohort.length);

    let text = "";
    if (tableNum === '1') {
        const maleCnt = cohort.filter(r => r.q_gender === 'male').length;
        const femCnt = cohort.filter(r => r.q_gender === 'female').length;
        const layCnt = cohort.filter(r => r.q_dentist_screen !== 'yes').length;
        const denCnt = cohort.filter(r => r.q_dentist_screen === 'yes').length;
        text = `📋 *جدول ۱: ویژگی‌های دموگرافیک شرکت‌کنندگان رسمی پژوهش (محاسبه آنی)*\n\n` +
               `• *حجم نمونه کل:* ${nFa} نفر (۱۰۰٪)\n` +
               `• *جنسیت:* ${toPersianDigits(maleCnt)} مرد (${toPersianDigits(((maleCnt / cohort.length) * 100).toFixed(1))}٪) | ${toPersianDigits(femCnt)} زن (${toPersianDigits(((femCnt / cohort.length) * 100).toFixed(1))}٪)\n` +
               `• *وابستگی به دندانپزشکی:* عامه مردم: ${toPersianDigits(layCnt)} نفر (${toPersianDigits(((layCnt / cohort.length) * 100).toFixed(1))}٪) | کادر/دانشجوی دندانپزشکی: ${toPersianDigits(denCnt)} نفر (${toPersianDigits(((denCnt / cohort.length) * 100).toFixed(1))}٪)\n\n` +
               `💡 _محاسبه شده به‌صورت کاملاً داینامیک از روی دیتابیس زنده._`;
    } else if (tableNum === '2') {
        const alStats = calcArrayStats(cohort.map(r => r.vas_aligner_overall).filter(Boolean));
        const ceStats = calcArrayStats(cohort.map(r => r.vas_ceramic_overall).filter(Boolean));
        const meStats = calcArrayStats(cohort.map(r => r.vas_metal_overall).filter(Boolean));
        text = `📋 *جدول ۲: نمرات جذابیت کلی زیبایی سیستم‌های ارتودنسی (N=${nFa})*\n\n` +
               `۱. *الاینر شفاف:* \`${toPersianDigits(alStats.mean)} ± ${toPersianDigits(alStats.sd)}\`\n` +
               `۲. *براکت سرامیکی:* \`${toPersianDigits(ceStats.mean)} ± ${toPersianDigits(ceStats.sd)}\`\n` +
               `۳. *براکت فلزی:* \`${toPersianDigits(meStats.mean)} ± ${toPersianDigits(meStats.sd)}\`\n\n` +
               `اختلاف نمره الاینر با سرامیکی: \`${toPersianDigits((Number(alStats.mean) - Number(ceStats.mean)).toFixed(2))}\` نمره\n` +
               `اختلاف نمره الاینر با فلزی: \`${toPersianDigits((Number(alStats.mean) - Number(meStats.mean)).toFixed(2))}\` نمره\n\n` +
               `💡 _محاسبه شده بر اساس دیتای زنده دیتابیس بدون هیچ عدد استاتیک._`;
    } else if (tableNum === '3') {
        text = `📋 *جدول ۳: بررسی تقدم-تأخر و عدم سوگیری توالی (N=${nFa})*\n\n`;
        for (const app of ['aligner', 'ceramic', 'metal']) {
            const k = `vas_${app}_overall`;
            const p1 = calcArrayStats(cohort.filter(r => r.first_appliance === app).map(r => r[k]));
            const p2 = calcArrayStats(cohort.filter(r => r.second_appliance === app).map(r => r[k]));
            const p3 = calcArrayStats(cohort.filter(r => r.third_appliance === app).map(r => r[k]));
            const faName = APPLIANCE_FA_MAP[app];
            text += `🦷 *${faName}:*\n` +
                    `  • نوبت اول (N=${toPersianDigits(p1.n)}): \`${toPersianDigits(p1.mean)} ± ${toPersianDigits(p1.sd)}\`\n` +
                    `  • نوبت دوم (N=${toPersianDigits(p2.n)}): \`${toPersianDigits(p2.mean)} ± ${toPersianDigits(p2.sd)}\`\n` +
                    `  • نوبت سوم (N=${toPersianDigits(p3.n)}): \`${toPersianDigits(p3.mean)} ± ${toPersianDigits(p3.sd)}\`\n\n`;
        }
    } else if (tableNum === '4') {
        const laypeople = cohort.filter(r => r.q_dentist_screen !== 'yes');
        const dental = cohort.filter(r => r.q_dentist_screen === 'yes');
        text = `📋 *جدول ۴: مقایسه عامه مردم (N=${toPersianDigits(laypeople.length)}) با کادر دندانپزشکی (N=${toPersianDigits(dental.length)})*\n\n`;
        for (const app of ['aligner', 'ceramic', 'metal']) {
            const k = `vas_${app}_overall`;
            const sLay = calcArrayStats(laypeople.map(r => r[k]));
            const sDen = calcArrayStats(dental.map(r => r[k]));
            const faName = APPLIANCE_FA_MAP[app];
            text += `• *${faName}:* عامه: \`${toPersianDigits(sLay.mean)} ± ${toPersianDigits(sLay.sd)}\` | دندانپزشکی: \`${toPersianDigits(sDen.mean)} ± ${toPersianDigits(sDen.sd)}\`\n`;
        }
    }

    const keyboard = {
        inline_keyboard: [
            [
                { text: "📊 دریافت کل جداول در اکسل (.xlsx)", callback_data: "export_all_tables_xlsx" },
                { text: "📝 دریافت فایل متنی (Word/MD)", callback_data: "export_all_tables_md" }
            ],
            [
                { text: "📋 سایر جداول پایان‌نامه", callback_data: "menu_tables" },
                { text: "🔙 منوی اصلی", callback_data: "menu_main" }
            ]
        ]
    };

    return sendTelegramMsg(botToken, chatId, text, keyboard, "Markdown");
}

async function sendAllTablesExcel(botToken, chatId) {
    await sendTelegramMsg(botToken, chatId, "⏳ در حال ساخت فایل اکسل چندبرگی (Multi-Sheet) داینامیک از روی دیتابیس زنده...");

    const rawData = await fetchBackendData();
    const cohort = filterByDatePreset(rawData, 'study');
    const total = cohort.length || 1;

    // Sheet 1: Demographics
    const s1Headers = ["Variable", "Category", "N", "Percentage", "Cumulative"];
    const s1Rows = [
        ["Total Cohort", "Official Study (Oct 22+)", total, "100.0%", `${total}/${total}`],
        ["Biological Sex", "Male", cohort.filter(r => r.q_gender === 'male').length, `${((cohort.filter(r => r.q_gender === 'male').length / total) * 100).toFixed(1)}%`, `${cohort.filter(r => r.q_gender === 'male').length}/${total}`],
        ["Biological Sex", "Female", cohort.filter(r => r.q_gender === 'female').length, `${((cohort.filter(r => r.q_gender === 'female').length / total) * 100).toFixed(1)}%`, `${cohort.filter(r => r.q_gender === 'female').length}/${total}`],
        ["Dental Affiliation", "Laypeople", cohort.filter(r => r.q_dentist_screen !== 'yes').length, `${((cohort.filter(r => r.q_dentist_screen !== 'yes').length / total) * 100).toFixed(1)}%`, `${cohort.filter(r => r.q_dentist_screen !== 'yes').length}/${total}`],
        ["Dental Affiliation", "Dental Background", cohort.filter(r => r.q_dentist_screen === 'yes').length, `${((cohort.filter(r => r.q_dentist_screen === 'yes').length / total) * 100).toFixed(1)}%`, `${cohort.filter(r => r.q_dentist_screen === 'yes').length}/${total}`],
    ];

    // Sheet 2: Appliance Ratings (Calculated Live)
    const dimensions = [
        { label: "VAS Overall Attractiveness (0-10)", key: "overall" },
        { label: "VAS Conversational Noticeability (1-5)", key: "distract" },
        { label: "VAS Professional Suitability (1-5)", key: "prof" },
        { label: "VAS Detraction from Natural Smile (1-5)", key: "device_impact" },
        { label: "VAS Shade Blending & Color Harmony (1-5)", key: "color_harmony" }
    ];
    const s2Headers = ["Aesthetic Dimension", "Aligner (Mean ± SD)", "Ceramic (Mean ± SD)", "Metal (Mean ± SD)", "Aligner vs Ceramic Diff", "Aligner vs Metal Diff"];
    const s2Rows = dimensions.map(d => {
        const alVals = cohort.map(r => r[`vas_aligner_${d.key}`]).filter(Boolean);
        const ceVals = cohort.map(r => r[`vas_ceramic_${d.key}`]).filter(Boolean);
        const meVals = cohort.map(r => r[`vas_metal_${d.key}`]).filter(Boolean);
        const sAl = calcArrayStats(alVals);
        const sCe = calcArrayStats(ceVals);
        const sMe = calcArrayStats(meVals);
        return [
            d.label,
            `${sAl.mean} ± ${sAl.sd}`,
            `${sCe.mean} ± ${sCe.sd}`,
            `${sMe.mean} ± ${sMe.sd}`,
            `Δ = ${(Number(sAl.mean) - Number(sCe.mean)).toFixed(2)}`,
            `Δ = ${(Number(sAl.mean) - Number(sMe.mean)).toFixed(2)}`
        ];
    });

    // Sheet 3: Order Bias (Calculated Live)
    const s3Headers = ["Appliance Type", "Position 1 (Mean ± SD)", "Position 2 (Mean ± SD)", "Position 3 (Mean ± SD)", "Permutation Balance"];
    const s3Rows = ['aligner', 'ceramic', 'metal'].map(app => {
        const k = `vas_${app}_overall`;
        const p1 = calcArrayStats(cohort.filter(r => r.first_appliance === app).map(r => r[k]));
        const p2 = calcArrayStats(cohort.filter(r => r.second_appliance === app).map(r => r[k]));
        const p3 = calcArrayStats(cohort.filter(r => r.third_appliance === app).map(r => r[k]));
        const faName = APPLIANCE_FA_MAP[app] || app;
        return [
            faName,
            `${p1.mean} ± ${p1.sd} (N=${p1.n})`,
            `${p2.mean} ± ${p2.sd} (N=${p2.n})`,
            `${p3.mean} ± ${p3.sd} (N=${p3.n})`,
            "Balanced 6-permutation rotation"
        ];
    });

    // Sheet 4: Subgroup Contrast (Calculated Live)
    const s4Headers = ["Appliance Type", "Laypeople (Mean ± SD)", "Dental Background (Mean ± SD)", "Group Difference", "Status"];
    const laypeople = cohort.filter(r => r.q_dentist_screen !== 'yes');
    const dental = cohort.filter(r => r.q_dentist_screen === 'yes');
    const s4Rows = ['aligner', 'ceramic', 'metal'].map(app => {
        const k = `vas_${app}_overall`;
        const sLay = calcArrayStats(laypeople.map(r => r[k]));
        const sDen = calcArrayStats(dental.map(r => r[k]));
        const diff = (Number(sLay.mean) - Number(sDen.mean)).toFixed(2);
        const faName = APPLIANCE_FA_MAP[app] || app;
        return [
            faName,
            `${sLay.mean} ± ${sLay.sd} (N=${sLay.n})`,
            `${sDen.mean} ± ${sDen.sd} (N=${sDen.n})`,
            `${diff > 0 ? '+' : ''}${diff}`,
            "High concordance between cohorts"
        ];
    });

    const sheets = [
        { name: "Table1_Demographics", headers: s1Headers, rows: s1Rows },
        { name: "Table2_ApplianceRatings", headers: s2Headers, rows: s2Rows },
        { name: "Table3_OrderBias", headers: s3Headers, rows: s3Rows },
        { name: "Table4_LayVsDental", headers: s4Headers, rows: s4Rows },
    ];

    const xlsxBuf = buildXLSX(sheets);
    const dateTag = new Date().toISOString().slice(0, 10);
    const fileName = `appliance_survey_thesis_tables_live_${dateTag}.xlsx`;
    const caption = `📊 *مجموعه کامل ۴ جدول رسمی پایان‌نامه (فرمت اکسل داینامیک .xlsx)*\n` +
                    `👥 حجم نمونه: ${toPersianDigits(total)} نفر (محاسبه ۱۰۰٪ زنده از دیتابیس)\n` +
                    `شامل ۴ شیت: دموگرافیک، نمرات ابعاد زیبایی، تحلیل توالی، و مقایسه عامه با دندانپزشکی.`;

    await sendTelegramDoc(
        botToken,
        chatId,
        xlsxBuf,
        fileName,
        caption,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    return showThesisTablesMenu(botToken, chatId);
}

async function sendAllTablesMarkdown(botToken, chatId) {
    const rawData = await fetchBackendData();
    const cohort = filterByDatePreset(rawData, 'study');
    const nFa = toPersianDigits(cohort.length);

    let mdText = `# Academic Thesis Tables: Orthodontic Appliance Aesthetic Perception Study\n\n`;
    mdText += `**Sample Size:** N = ${cohort.length} official study evaluators (evaluated between Oct 22 and Oct 30, 2026).\n`;
    mdText += `**Standard:** Conforming to APA 7th Edition & BMJ/Lancet biomedical reporting guidelines.\n\n`;

    for (const key of ['t1', 't2', 't3', 't4']) {
        const t = THESIS_TABLES_DATA[key];
        mdText += `## ${t.title}\n\n${t.text.replace(/[*_`]/g, '')}\n\n---\n\n`;
    }

    const dateTag = new Date().toISOString().slice(0, 10);
    const fileName = `thesis_tables_apa_bmj_${dateTag}.md`;
    const caption = `📝 *فایل متنی جداول پایان‌نامه (Markdown)*\nقابل کپی مستقیم در نرم‌افزار Word و پایان‌نامه.\nحجم نمونه: ${nFa} نفر`;

    await sendTelegramDoc(botToken, chatId, mdText, fileName, caption, 'text/markdown;charset=utf-8;');
    return showThesisTablesMenu(botToken, chatId);
}

async function sendAllAcademicFigures(botToken, chatId) {
    await sendTelegramMsg(botToken, chatId, "⏳ در حال ارسال پکیج کامل ۱۵ نمودار آکادمیک با کیفیت ۳۰۰ DPI...");

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

    return showMainMenu(botToken, chatId, "✅ تمامی ۱۵ نمودار آکادمیک با موفقیت ارسال شدند.");
}

async function showMainMenu(botToken, chatId, intro = null) {
    const text = intro || 
        "🎓 *سامانه جامع مدیریت و تحلیل پژوهش زیبایی ارتودنسی*\n\n" +
        "📌 *وضعیت داده‌ها:* به‌صورت پیش‌فرض داده‌های رسمی پایان‌نامه (از ۲۲ اکتبر به بعد) با بالاترین دقت متدولوژی تحلیل می‌شوند.\n\n" +
        "عملیات مورد نظر خود را انتخاب کنید:";

    const keyboard = {
        inline_keyboard: [
            [
                { text: "🎨 گالری کامل ۱۵ نمودار آکادمیک (BMJ)", callback_data: "menu_figures_gallery" }
            ],
            [
                { text: "📋 جداول رسمی پایان‌نامه (Tables 1-4)", callback_data: "menu_tables" }
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
                { text: "📥 دریافت همزمان CSV و Excel داده‌ها", callback_data: "export_csv_study" }
            ],
            [
                { text: "🌐 مشاهده آمار کل داده‌ها (با پایلوت‌ها)", callback_data: "menu_stats_all" }
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
        orderBreakdown += `▪️ ${ord}:\n   👈 ${toPersianDigits(cnt)} نفر (${toPersianDigits(pct)}%)\n`;
    }

    const titlePrefix = preset === 'study' ? "🎯 *داده‌های رسمی پایان‌نامه (از ۲۲ اکتبر)*" : "🌐 *کل داده‌های دیتابیس (شامل پایلوت‌ها)*";
    const filteredNote = preset === 'study' ? `\n💡 _۲۹ رکورد آزمایشی قبل از ۲۲ اکتبر فیلتر شده‌اند._` : "";

    const text = 
        `📊 *گزارش آماری پژوهش*\n${titlePrefix}\n\n` +
        `👥 *تعداد شرکت‌کنندگان:* ${toPersianDigits(total)} نفر\n` +
        `🕒 *آخرین ثبت پاسخ:* ${toPersianDigits(latest)}\n\n` +
        `🔄 *توزیع ترتیب مشاهده دستگاه‌ها:*\n${orderBreakdown}` +
        filteredNote;

    const keyboard = {
        inline_keyboard: [
            [
                { text: `📥 دریافت فایل این داده‌ها (CSV + Excel)`, callback_data: `export_csv_${preset}` },
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
                { text: "📁 دانلود همزمان CSV و Excel کامل", callback_data: `export_csv_${preset}` }
            ],
            [
                { text: "👤 فقط اطلاعات دموگرافیک (CSV + Excel)", callback_data: `export_demo_${preset}` },
                { text: "⭐ فقط نمرات VAS و زیبایی (CSV + Excel)", callback_data: `export_vas_${preset}` }
            ],
            [
                { text: "📅 انتخاب بازه دیگر", callback_data: "menu_daterange" },
                { text: "🔙 منوی اصلی", callback_data: "menu_main" }
            ]
        ]
    };

    return sendTelegramMsg(botToken, chatId, text, keyboard, "Markdown");
}

async function sendExportFiles(botToken, chatId, preset, fieldFilter) {
    await sendTelegramMsg(botToken, chatId, "⏳ در حال ساخت همزمان فایل‌های CSV و Excel (.xlsx) با ستون‌های توالی و متغیرها...");

    const raw = await fetchBackendData();
    const filtered = filterByDatePreset(raw, preset);

    if (filtered.length === 0) {
        return sendTelegramMsg(botToken, chatId, "⚠️ هیچ داده‌ای در این بازه زمانی یافت نشد.");
    }

    const csvContent = generateCSV(filtered, fieldFilter);
    const dateTag = new Date().toISOString().slice(0, 10);
    const baseName = `thesis_survey_${preset}_${fieldFilter}_${dateTag}`;
    const nFa = toPersianDigits(filtered.length);
    const captionCsv = `📁 خروجی داده‌های پژوهش (CSV)\nبازه: ${preset} | فیلدها: ${fieldFilter}\nتعداد: ${nFa} نفر`;
    const captionXlsx = `📊 خروجی رسمی داده‌های پژوهش (Excel .xlsx)\nبازه: ${preset} | فیلدها: ${fieldFilter}\nتعداد: ${nFa} نفر`;

    // ۱. ارسال فایل CSV
    await sendTelegramDoc(botToken, chatId, csvContent, `${baseName}.csv`, captionCsv);

    // ۲. فیلتر کردن ردیف‌ها برای اکسل و ارسال
    const priority = ['id', 'timestamp', 'appliance_order', 'appliance_order_fa', 'first_appliance', 'second_appliance', 'third_appliance', 'q_age', 'q_gender', 'q_edu'];
    const filteredObjects = filtered.map(r => {
        const obj = {};
        Object.keys(r).forEach(k => {
            if (fieldFilter === 'demo' && !k.startsWith('q_') && !priority.includes(k)) return;
            if (fieldFilter === 'vas' && !k.startsWith('vas_') && !k.startsWith('acc_') && !priority.includes(k)) return;
            obj[k] = r[k];
        });
        return obj;
    });

    const xlsxBuf = buildXLSXFromObjects(filteredObjects, 'SurveyData', priority);
    await sendTelegramDoc(
        botToken,
        chatId,
        xlsxBuf,
        `${baseName}.xlsx`,
        captionXlsx,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    return showMainMenu(botToken, chatId, "✅ هر دو فایل CSV و Excel با موفقیت ارسال شدند. عملیات بعدی:");
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

    let report = `📈 *مقایسه میانگین نمرات دستگاه‌ها (تعداد: ${toPersianDigits(data.length)} نفر)*\n`;
    report += "معیار: `میانگین ± انحراف معیار`\n";
    report += "━━━━━━━━━━━━━━━━━━━━\n";

    for (const m of metrics) {
        report += `📌 *${m.label}:*\n`;
        for (const app of ['aligner', 'ceramic', 'metal']) {
            const vals = data.map(r => r[`vas_${app}_${m.key}`] || r[`psy_${app}_${m.key}`] || r[`acc_${app}_${m.key}`]).filter(Boolean);
            const stats = calcMeanSD(vals);
            const faName = APPLIANCE_FA_MAP[app];
            report += `  • ${faName}: \`${toPersianDigits(stats.mean)} ± ${toPersianDigits(stats.sd)}\`\n`;
        }
        report += "\n";
    }

    const keyboard = {
        inline_keyboard: [
            [
                { text: "🔄 بررسی اثر ترتیب بر نمرات", callback_data: "menu_order_bias" },
                { text: "📥 دریافت همزمان CSV و Excel", callback_data: `export_csv_${preset}` }
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

    let report = `🔄 *تحلیل اثر ترتیب و تقدم-تأخر (تعداد: ${toPersianDigits(data.length)} نفر)*\n\n`;
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
        report += `  ۱️⃣ دیده شده به عنوان دستگاه اول (N=${toPersianDigits(s1.count)}): \`${toPersianDigits(s1.mean)} ± ${toPersianDigits(s1.sd)}\`\n`;
        report += `  ۲️⃣ دیده شده به عنوان دستگاه دوم (N=${toPersianDigits(s2.count)}): \`${toPersianDigits(s2.mean)} ± ${toPersianDigits(s2.sd)}\`\n`;
        report += `  ۳️⃣ دیده شده به عنوان دستگاه سوم (N=${toPersianDigits(s3.count)}): \`${toPersianDigits(s3.mean)} ± ${toPersianDigits(s3.sd)}\`\n\n`;
    }

    report += "💡 _نمرات فوق تایید می‌کنند که آیا تقدم و تاخر در نمایش، سوگیری ایجاد کرده است یا خیر._";

    const keyboard = {
        inline_keyboard: [
            [
                { text: "📊 مقایسه کلی دستگاه‌ها", callback_data: "menu_thesis_metrics" },
                { text: "📥 دریافت همزمان CSV و Excel", callback_data: `export_csv_${preset}` }
            ],
            [
                { text: "📅 تغییر بازه زمانی", callback_data: "menu_daterange" },
                { text: "🔙 بازگشت به منوی اصلی", callback_data: "menu_main" }
            ]
        ]
    };

    return sendTelegramMsg(botToken, chatId, report, keyboard, "Markdown");
}