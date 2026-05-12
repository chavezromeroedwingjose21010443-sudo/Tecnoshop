export const config = { runtime: ‘edge’ };

export default async function handler(req) {
const headers = {
‘Access-Control-Allow-Origin’: ‘*’,
‘Access-Control-Allow-Methods’: ‘GET,OPTIONS’,
‘Content-Type’: ‘application/json’
};

if (req.method === ‘OPTIONS’) {
return new Response(null, { status: 200, headers });
}

const CLIENT_ID = process.env.EBAY_CLIENT_ID;
const CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;
const SELLERS = [‘discounttechdirect’, ‘merresale’, ‘paymore_doraville’];

try {
const credentials = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
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
if (!tokenData.access_token) {
  return new Response(JSON.stringify({ error: 'Token error', details: tokenData }), { status: 500, headers });
}

const token = tokenData.access_token;
const url = new URL(req.url);
const q = url.searchParams.get('q') || 'laptop';
const limit = url.searchParams.get('limit') || '20';

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

return new Response(
  JSON.stringify({ success: true, total: data.total || 0, products }),
  { status: 200, headers }
);
```

} catch (err) {
return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
}
}
