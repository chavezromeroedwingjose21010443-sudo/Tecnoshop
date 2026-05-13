export default async function handler(req, res) {
res.setHeader(‘Access-Control-Allow-Origin’, ‘*’);
res.setHeader(‘Content-Type’, ‘application/json’);

const CLIENT_ID = process.env.EBAY_CLIENT_ID;
const CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
return res.status(500).json({ error: ‘Missing env vars’, CLIENT_ID: !!CLIENT_ID, CLIENT_SECRET: !!CLIENT_SECRET });
}

return res.status(200).json({ ok: true, CLIENT_ID: CLIENT_ID.substring(0, 10) + ‘…’ });
}