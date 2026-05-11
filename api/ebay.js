export default async function handler(req, res) {
res.setHeader(‘Access-Control-Allow-Origin’, ‘*’);
res.setHeader(‘Access-Control-Allow-Methods’, ‘GET,POST,OPTIONS’);
res.setHeader(‘Access-Control-Allow-Headers’, ‘Content-Type’);
if (req.method === ‘OPTIONS’) return res.status(200).end();

const CLIENT_ID = process.env.EBAY_CLIENT_ID;
const CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;
const SELLERS = [‘discounttechdirect’, ‘merresale’, ‘paymore_doraville’];

try {
const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString(‘base64’);
const tokenRes = await fetch(‘https://api.ebay.com/identity/v1/oauth2/token’, {
method: ‘POST’,
headers: {
‘Authorization’: `Basic ${credentials}`,
‘Content-Type’: ‘application/x-www-form-urlencoded’
},
body: ‘grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope’
});

```
const tokenData = await tokenRes.json();
if (!tokenData.access_token) return res.status(500).json({ error: 'Token error', details: tokenData });

const token = tokenData.access_token;
const { q = 'laptop', limit = 20 } = req.query;

const searchRes = await fetch(
  `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}&filter=sellers:{${SELLERS.join('|')}}&limit=${limit}`,
  { headers: { 'Authorization': `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' } }
);

const data = await searchRes.json();
const COMM = 0.30, AIR = 45, SEA = 22;

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
return res.status(500).json({ error: err.message });
}
}
