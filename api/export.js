// api/export.js
// Ultra-fresh, dynamic export endpoint for CSV and Excel files.
// Fetches live database records in real-time and computes sequences and tables on the fly.

import { buildXLSX, buildXLSXFromObjects } from './xlsx_builder.js';

const BACKEND_URL = "http://91.212.174.223:9090/api/data";
const DEFAULT_STUDY_START = "2026-10-22";

const APPLIANCE_FA_MAP = {
    aligner: "الاینر شفاف",
    ceramic: "براکت سرامیکی",
    metal: "براکت فلزی"
};

// Reconstruct presentation sequence
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

// Stats helper
function calcStats(nums) {
    const valid = nums.map(Number).filter(n => !isNaN(n));
    if (valid.length === 0) return { n: 0, mean: 0, sd: 0, median: 0, q1: 0, q3: 0, iqr: 0 };
    valid.sort((a, b) => a - b);
    const n = valid.length;
    const mean = valid.reduce((a, b) => a + b, 0) / n;
    const variance = n > 1 ? valid.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (n - 1) : 0;
    const sd = Math.sqrt(variance);

    const getPercentile = (p) => {
        const idx = (n - 1) * p;
        const low = Math.floor(idx);
        const high = Math.ceil(idx);
        if (low === high) return valid[low];
        return valid[low] + (valid[high] - valid[low]) * (idx - low);
    };

    const q1 = getPercentile(0.25);
    const median = getPercentile(0.50);
    const q3 = getPercentile(0.75);
    const iqr = q3 - q1;

    return {
        n,
        mean: Number(mean.toFixed(2)),
        sd: Number(sd.toFixed(2)),
        median: Number(median.toFixed(2)),
        q1: Number(q1.toFixed(2)),
        q3: Number(q3.toFixed(2)),
        iqr: Number(iqr.toFixed(2))
    };
}

// Fetch live backend data with cache busting
async function fetchLiveData() {
    const res = await fetch(BACKEND_URL, {
        headers: {
            'User-Agent': 'DynamicExportService/1.0',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache'
        },
        cache: 'no-store'
    });
    if (!res.ok) throw new Error(`Backend returned status ${res.status}`);
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
        row.order_appliance_1 = order[0] || '';
        row.order_appliance_2 = order[1] || '';
        row.order_appliance_3 = order[2] || '';
        return row;
    });
}

// Filter dataset
function filterDataset(data, query) {
    const { preset = 'study', start_date, end_date } = query;

    return data.filter(row => {
        const ts = row.timestamp ? String(row.timestamp).trim() : '';
        const dateOnly = ts.split(' ')[0] || ts.split('T')[0] || '';

        if (start_date && dateOnly < start_date) return false;
        if (end_date && dateOnly > end_date) return false;
        if (start_date || end_date) return true;

        if (preset === 'all') return true;

        const now = new Date();
        const rowDate = dateOnly ? new Date(dateOnly) : null;

        if (preset === 'study') {
            return dateOnly >= DEFAULT_STUDY_START;
        }
        if (preset === 'today') {
            return dateOnly === now.toISOString().slice(0, 10);
        }
        if (preset === '3days') {
            const limit = new Date(now.getTime() - 3 * 24 * 3600 * 1000).toISOString().slice(0, 10);
            return dateOnly >= limit;
        }
        if (preset === '7days') {
            const limit = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
            return dateOnly >= limit;
        }
        return true;
    });
}

// Escape CSV
const escapeCSV = (val) => `"${String(val !== undefined && val !== null ? val : '').replace(/"/g, '""')}"`;

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
        const query = req.query || (req.url ? Object.fromEntries(new URL(req.url, 'http://localhost').searchParams) : {});
        const rawData = await fetchLiveData();
        const cohort = filterDataset(rawData, query);

        const format = (query.format || 'xlsx').toLowerCase();
        const exportType = (query.type || 'survey').toLowerCase();
        const preset = query.preset || 'study';
        const dateTag = new Date().toISOString().slice(0, 10);

        // -------------------------------------------------------------
        // TYPE: TABLES (4 APA/BMJ Thesis Tables in Multi-Sheet Excel)
        // -------------------------------------------------------------
        if (exportType === 'tables') {
            const total = cohort.length;

            // Sheet 1: Demographics
            const s1Headers = ["Variable", "Stratum", "Frequency (N)", "Percentage (%)", "Summary"];
            const s1Rows = [];
            const addDemo = (v, s, n) => s1Rows.push([v, s, n, `${((n / total) * 100).toFixed(1)}%`, `${n}/${total}`]);
            addDemo("Total Sample Size", `Cohort (${preset})`, total);
            for (const g of ['male', 'female']) {
                const cnt = cohort.filter(r => r.q_gender === g).length;
                addDemo("Gender", g === 'male' ? 'Male' : 'Female', cnt);
            }
            for (const a of ['<18', '18-24', '25-34', '35-44', '45-54', '55+']) {
                const cnt = cohort.filter(r => r.q_age === a).length;
                if (cnt > 0) addDemo("Age Group", a, cnt);
            }
            for (const ed of ['student', 'diploma', 'bachelor', 'master', 'phd_md']) {
                const cnt = cohort.filter(r => r.q_edu === ed).length;
                if (cnt > 0) addDemo("Education", ed, cnt);
            }
            for (const m of ['single', 'married']) {
                const cnt = cohort.filter(r => r.q_marital === m).length;
                if (cnt > 0) addDemo("Marital Status", m, cnt);
            }
            for (const d of ['no', 'yes']) {
                const cnt = cohort.filter(r => r.q_dentist_screen === d).length;
                addDemo("Dental Background", d === 'yes' ? 'Dentist / Student' : 'Layperson', cnt);
            }

            // Sheet 2: Ratings
            const s2Headers = ["Outcome Dimension", "Appliance", "N", "Mean", "SD", "Median", "IQR"];
            const s2Rows = [];
            const dimensions = [
                { name: "Overall Aesthetic Attractiveness (VAS 0-10)", key: "overall" },
                { name: "Noticeability in Conversation (VAS 1-5)", key: "distract" },
                { name: "Professional Suitability (VAS 1-5)", key: "prof" },
                { name: "Workplace Embarrassment / Hesitation (Likert 1-5)", key: "work" },
                { name: "Social Distance / Avoidance (Likert 1-5)", key: "social" },
                { name: "Perceived Intellectual Competence (Likert 1-5)", key: "intel" },
                { name: "Perceived Oral Hygiene Discipline (Likert 1-5)", key: "hygiene" },
                { name: "Perceived Interpersonal Attractiveness (Likert 1-5)", key: "attract" },
                { name: "Perceived Integrity & Trustworthiness (Likert 1-5)", key: "trust" },
                { name: "Perceived Socioeconomic Status (Likert 1-5)", key: "ses" },
                { name: "Perceived Self-Confidence (Likert 1-5)", key: "confidence" }
            ];

            for (const dim of dimensions) {
                for (const app of ['aligner', 'ceramic', 'metal']) {
                    const vals = cohort.map(r => r[`vas_${app}_${dim.key}`] || r[`psy_${app}_${dim.key}`] || r[`acc_${app}_${dim.key}`]).filter(v => v !== undefined && v !== '');
                    const s = calcStats(vals);
                    const appLabel = app === 'aligner' ? 'Clear Aligner' : (app === 'ceramic' ? 'Ceramic Bracket' : 'Metallic Bracket');
                    s2Rows.push([dim.name, appLabel, s.n, s.mean, s.sd, s.median, s.iqr]);
                }
            }

            // Sheet 3: Sequence Bias
            const s3Headers = ["Appliance", "Viewed 1st (Mean ± SD)", "Viewed 2nd (Mean ± SD)", "Viewed 3rd (Mean ± SD)"];
            const s3Rows = [];
            for (const app of ['aligner', 'ceramic', 'metal']) {
                const k = `vas_${app}_overall`;
                const p1 = calcStats(cohort.filter(r => r.first_appliance === app).map(r => r[k]));
                const p2 = calcStats(cohort.filter(r => r.second_appliance === app).map(r => r[k]));
                const p3 = calcStats(cohort.filter(r => r.third_appliance === app).map(r => r[k]));
                const appLabel = app === 'aligner' ? 'Clear Aligner' : (app === 'ceramic' ? 'Ceramic Bracket' : 'Metallic Bracket');
                s3Rows.push([
                    appLabel,
                    `${p1.mean} ± ${p1.sd} (N=${p1.n})`,
                    `${p2.mean} ± ${p2.sd} (N=${p2.n})`,
                    `${p3.mean} ± ${p3.sd} (N=${p3.n})`
                ]);
            }

            // Sheet 4: Laypeople vs Dental
            const s4Headers = ["Appliance Metric", "Laypeople Mean ± SD (N)", "Dental Professionals Mean ± SD (N)", "Group Mean Diff"];
            const s4Rows = [];
            const laypeople = cohort.filter(r => r.q_dentist_screen !== 'yes');
            const dental = cohort.filter(r => r.q_dentist_screen === 'yes');
            for (const app of ['aligner', 'ceramic', 'metal']) {
                const k = `vas_${app}_overall`;
                const sLay = calcStats(laypeople.map(r => r[k]));
                const sDen = calcStats(dental.map(r => r[k]));
                const appLabel = app === 'aligner' ? 'Clear Aligner' : (app === 'ceramic' ? 'Ceramic Bracket' : 'Metallic Bracket');
                const diff = (sLay.mean - sDen.mean).toFixed(2);
                s4Rows.push([
                    `${appLabel} - VAS Overall`,
                    `${sLay.mean} ± ${sLay.sd} (N=${sLay.n})`,
                    `${sDen.mean} ± ${sDen.sd} (N=${sDen.n})`,
                    diff
                ]);
            }

            const sheets = [
                { name: "Table1_Demographics", headers: s1Headers, rows: s1Rows },
                { name: "Table2_ApplianceRatings", headers: s2Headers, rows: s2Rows },
                { name: "Table3_SequenceBias", headers: s3Headers, rows: s3Rows },
                { name: "Table4_LayVsDental", headers: s4Headers, rows: s4Rows }
            ];

            const xlsxBuf = buildXLSX(sheets);
            res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
            res.setHeader("Content-Disposition", `attachment; filename="thesis_tables_live_${preset}_${dateTag}.xlsx"`);
            return res.status(200).send(xlsxBuf);
        }

        // -------------------------------------------------------------
        // TYPE: SURVEY (Raw Responses Dataset with Sequences)
        // -------------------------------------------------------------
        const priorityCols = [
            'id', 'timestamp', 'appliance_order', 'appliance_order_fa',
            'order_appliance_1', 'order_appliance_2', 'order_appliance_3',
            'first_appliance', 'second_appliance', 'third_appliance',
            'q_age', 'q_gender', 'q_edu', 'q_marital', 'q_dentist_screen',
            'q_satisfaction', 'q_importance_appearance', 'q_history', 'q_current_need',
            'q_social_media', 'q_familiarity'
        ];

        const allKeys = new Set(priorityCols);
        cohort.forEach(r => Object.keys(r).forEach(k => allKeys.add(k)));
        const headers = Array.from(allKeys);

        if (format === 'csv') {
            const csvRows = [];
            csvRows.push('\uFEFF' + headers.map(escapeCSV).join(','));
            cohort.forEach(row => {
                const line = headers.map(h => escapeCSV(row[h] !== undefined ? row[h] : '')).join(',');
                csvRows.push(line);
            });
            const csvOutput = csvRows.join('\n');
            res.setHeader("Content-Type", "text/csv; charset=utf-8;");
            res.setHeader("Content-Disposition", `attachment; filename="appliance_survey_live_${preset}_${dateTag}.csv"`);
            return res.status(200).send(csvOutput);
        } else {
            const xlsxBuf = buildXLSXFromObjects(cohort, 'SurveyResponses', priorityCols);
            res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
            res.setHeader("Content-Disposition", `attachment; filename="appliance_survey_live_${preset}_${dateTag}.xlsx"`);
            return res.status(200).send(xlsxBuf);
        }

    } catch (err) {
        console.error("Export handler error:", err);
        return res.status(500).json({ error: 'Failed to generate dynamic export', message: err.message });
    }
}
