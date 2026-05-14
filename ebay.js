const https = require(‘https’);

const SELLERS = [‘discounttechdirect’, ‘merresale’, ‘paymore_doraville’];

function request(options, body) {
return new Promise((resolve, reject) => {
const req = https.request(options, (res) => {
let d = ‘’;
res.on(‘data’, c => d += c);
res.on(‘end’, () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
});
req.on(‘error’, reject);
if (body) req.write(body);
req.end();
});
}

exports.handler = async (event) => {
const headers = {
‘Access-Control-Allow-Origin’: ‘*’,
‘Content-Type’: ‘application/json’
};

const ID = process.env.EBAY_CLIENT_ID;
const SECRET = process.env.EBAY_CLIENT_SECRET;

if (!ID || !SECRET) {
return { statusCode: 500, headers, body: JSON.stringify({ error: ‘Missing credentials’ }) };
}

try {
const creds = Buffer.from(ID + ‘:’ + SECRET).toString(‘base64’);
const body = ‘grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope’;

```
const token = await request({
  hostname: 'api.ebay.com',
  path: '/identity/v1/oauth2/token',
  method: 'POST',
  headers: {
    'Authorization': 'Basic ' + creds,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(body)
  }
}, body);

if (!token.access_token) {
  return { statusCode: 500, headers, body: JSON.stringify({ error: 'Token failed', detail: token }) };
}

const q = ((event.queryStringParameters && event.queryStringParameters.q) || 'laptop').replace(/ /g, '+');
const sellers = SELLERS.join('|');

const data = await request({
  hostname: 'api.ebay.com',
  path: '/buy/browse/v1/item_summary/search?q=' + q + '&filter=sellers:{' + sellers + '}&limit=20',
  method: 'GET',
  headers: {
    'Authorization': 'Bearer ' + token.access_token,
    'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
  }
});

const products = (data.itemSummaries || []).map(item => {
  const base = parseFloat((item.price && item.price.value) || 0);
  const comm = base * 0.30;
  return {
    id: item.itemId,
    title: item.title,
    price: base,
    totalAir: +(base + comm + 45).toFixed(2),
    totalSea: +(base + comm + 22).toFixed(2),
    condition: item.condition || 'Used',
    image: (item.image && item.image.imageUrl) || '',
    listingType: (item.buyingOptions || []).includes('AUCTION') ? 'auction' :
                 (item.buyingOptions || []).includes('BEST_OFFER') ? 'offer' : 'buy'
  };
});

return {
  statusCode: 200,
  headers,
  body: JSON.stringify({ success: true, total: data.total || 0, products })
};
```

} catch (err) {
return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
}
};