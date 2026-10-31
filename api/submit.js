// api/submit.js
// Serverless proxy to submit survey responses directly to backend database

const BACKEND_SUBMIT_URL = "http://91.212.174.223:9090/api/submit";

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const upstream = await fetch(BACKEND_SUBMIT_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'VercelSubmitProxy/1.0'
            },
            body: JSON.stringify(req.body)
        });

        const data = await upstream.json().catch(() => ({ status: upstream.ok ? 'success' : 'error' }));
        return res.status(upstream.status).json(data);
    } catch (error) {
        console.error("Error proxying submit to database:", error);
        return res.status(500).json({ error: 'Failed to submit response to database' });
    }
}
