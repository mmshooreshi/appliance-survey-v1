// api/data.js
// Serverless proxy to fetch survey records without browser mixed-content restrictions.
// Automatically enriches all historical and live records with presentation sequence orders.

const BACKEND_URL = "http://91.212.174.223:9090/api/data";

const APPLIANCE_FA_MAP = {
    aligner: "الاینر شفاف",
    ceramic: "براکت سرامیکی",
    metal: "براکت فلزی"
};

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

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const upstream = await fetch(BACKEND_URL, {
            headers: {
                'User-Agent': 'VercelProxy/1.0',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            },
            cache: 'no-store'
        });
        if (!upstream.ok) {
            return res.status(upstream.status).json({ error: `Upstream returned status ${upstream.status}` });
        }
        const data = await upstream.json();

        // Enrich every record with reconstructed sequence orders
        const enriched = data.map(item => {
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

        return res.status(200).json(enriched);
    } catch (error) {
        console.error("Error proxying data fetch:", error);
        return res.status(500).json({ error: 'Failed to fetch upstream database data' });
    }
}
