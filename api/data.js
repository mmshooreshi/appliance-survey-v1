// api/data.js
// Serverless proxy to fetch survey records without browser mixed-content restrictions

const BACKEND_URL = "http://91.212.174.223:9090/api/data";

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const upstream = await fetch(BACKEND_URL, {
            headers: { 'User-Agent': 'VercelProxy/1.0' }
        });
        if (!upstream.ok) {
            return res.status(upstream.status).json({ error: `Upstream returned status ${upstream.status}` });
        }
        const data = await upstream.json();
        return res.status(200).json(data);
    } catch (error) {
        console.error("Error proxying data fetch:", error);
        return res.status(500).json({ error: 'Failed to fetch upstream database data' });
    }
}
