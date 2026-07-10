// api/ebay.js
// Busca productos en eBay Browse API y devuelve datos limpios para TecnoShop.
// Incluye imagen principal + imágenes adicionales (para carrusel en el frontend).

const https = require('https');

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const ID = process.env.EBAY_CLIENT_ID;
  const SECRET = process.env.EBAY_CLIENT_SECRET;
  if (!ID || !SECRET) return res.status(500).json({ success: false, error: 'Missing credentials' });

  const q = req.query.q || 'laptop';
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;

  try {
    // 1. Token OAuth
    const creds = Buffer.from(ID + ':' + SECRET).toString('base64');
    const body = 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope';
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

    if (!token.access_token) return res.status(500).json({ success: false, error: 'Token failed' });

    // 2. Búsqueda de productos
    const searchPath = '/buy/browse/v1/item_summary/search?q=' + encodeURIComponent(q) +
      '&limit=' + limit + '&offset=' + offset +
      '&filter=' + encodeURIComponent('sellerAccountTypes:{BUSINESS},itemLocationCountry:US');

    const searchRes = await request({
      hostname: 'api.ebay.com',
      path: searchPath,
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + token.access_token,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
      }
    });

    const items = searchRes.itemSummaries || [];

    const products = items.map(item => {
      // imagen principal
      const mainImage = (item.image && item.image.imageUrl) || '';
      // imágenes adicionales (thumbnailImages) -> para carrusel
      const extraImages = (item.thumbnailImages || [])
        .map(t => t.imageUrl)
        .filter(url => url && url !== mainImage);
      const allImages = mainImage ? [mainImage, ...extraImages] : extraImages;

      return {
        id: item.itemId,
        title: item.title,
        price: item.price ? parseFloat(item.price.value) : 0,
        condition: item.condition || 'Used',
        listingType: (item.buyingOptions || []).includes('BEST_OFFER') ? 'offer' : 'buy',
        image: mainImage,
        images: allImages, // NUEVO: array completo para el carrusel
        itemWebUrl: item.itemWebUrl || ''
      };
    });

    return res.status(200).json({
      success: true,
      total: searchRes.total || products.length,
      products
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Fetch failed', detail: String(e) });
  }
};
