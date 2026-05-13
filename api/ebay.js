const https = require(‘https’);

const SELLERS = [‘discounttechdirect’, ‘merresale’, ‘paymore_doraville’];
const COMM = 0.30, AIR = 45, SEA = 22;

function httpRequest(url, options, body) {
return new Promise((resolve, reject) => {
const req = https.request(url, options, (res) => {
let data = ‘’;
res.on(‘data’, chunk => data += chunk);
res.on(‘end’, () => {
try { resolve(JSON.parse(data)); }
catch(e) { reject(e); }
});
});
req.on(‘error’, reject);
if (body) req.write(body);
req.end();
});
}

module.exports = async function handler(req, res) {
res.setHeader(‘Access-Control-Allow-Origin’, ‘*’);
res.setHeader(‘Content-Type’, ‘application/json’);
if (req.method === ‘OPTIONS’) return res.status(200).end();

const CLIENT_ID = process.env.EBAY_CLIENT_ID;
const CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
return res.status(500).json({ error: ‘Missing credentials’ });
}

try {
const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString(‘base64’);
const tokenBody = ‘grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope’;

```
const tokenData = await httpRequest('https://api.ebay.com/identity/v1/oauth2/token', {
  method: 'POST',
  headers: {
    'Authorization': `Basic ${credentials}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(tokenBody)
  }
}, tokenBody);

if (!tokenData.access_token) {
  return res.status(500).json({ error: 'Token error', details: tokenData });
}

const token = tokenData.access_token;
const q = req.query.q || 'laptop';
const limit = req.query.limit || '20';
const sellerFilter = SELLERS.join('|');
const searchPath = `/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}&filter=sellers:{${sellerFilter}}&limit=${limit}`;

const data = await httpRequest(`https://api.ebay.com${searchPath}`, {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`,
    'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
    'Content-Type': 'application/json'
  }
});

const products = (data.itemSummaries || []).map(item => {
  const base = parseFloat(item.price?.value || 0);
  const comm = base * COMM;
  return {
    id: item.itemId,
    title: item.title,
    price: base,
    totalAir: +(base + comm + AIR).toFixed(2),
    totalSea: +(base + comm + SEA).toFixed(2),
    commission: +comm.toFixed(2),
    condition: item.condition || 'Used',
    image: item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || '',
    seller: 'TecnoShop',
    listingType: item.buyingOptions?.includes('AUCTION') ? 'auction' :
                 item.buyingOptions?.includes('BEST_OFFER') ? 'offer' : 'buy',
    bidCount: item.bidCount || 0
  };
});

return res.status(200).json({ success: true, total: data.total || 0, products });
```

} catch (err) {
return res.status(500).json({ error: err.message, stack: err.stack });
}
};