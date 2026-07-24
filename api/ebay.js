// api/ebay.js
// Busca productos en eBay Browse API y devuelve datos limpios para TecnoShop.
// Solo muestra productos de vendedores de confianza previamente seleccionados.
// Incluye imagen principal + imágenes adicionales (para carrusel en el frontend).

const https = require('https');

// ── VENDEDORES DE CONFIANZA (app de prueba) ──
// Lista temporal, sujeta a cambios mientras se define el sistema definitivo.
const TRUSTED_SELLERS = [
  'paymoretaylor',
  'tradingpostelectronics',
  'electronicbuyandsell',
  'paymoreirving',
  'tpmresale',
  'paymoremidtown',
  'paymorecopperfield',
  'paymoreellicottcity',
  'paymore_fontana',
  'paymorehelotes',
  'paymore_irving',
  'paymorelivonia',
  'paymorelansing',
  'paymoregrandrapids',
  'paymoregreensboro',
  'paymoreraleigh'
];

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

  // ── SEGMENTO INTERNO: solo artículos "BROKEN" (uso propio, búsqueda rápida) ──
  // Activar con ?broken=true en la URL. Se combina con la palabra de búsqueda normal.
  const brokenOnly = req.query.broken === 'true';
  const searchQuery = brokenOnly ? (q + ' BROKEN') : q;

  // ── FILTROS OPCIONALES (vienen del panel de filtros del frontend) ──
  // sort: newlyListed | price | -price  (best_match es el default de eBay, no se envía)
  // buying: FIXED_PRICE | AUCTION | BEST_OFFER  (formato de compra)
  // condition: NEW | USED
  // priceMin / priceMax: rango de precio en USD
  const sort = req.query.sort || '';
  const buying = req.query.buying || '';
  const condition = req.query.condition || '';
  const priceMin = req.query.priceMin || '';
  const priceMax = req.query.priceMax || '';

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

    // 2. Construir filtros combinados — SIEMPRE incluye el filtro de vendedores de confianza
    const filterParts = ['sellers:{' + TRUSTED_SELLERS.join('|') + '}'];
    if (buying) filterParts.push('buyingOptions:{' + buying + '}');
    if (condition) filterParts.push('conditionIds:{' + (condition === 'NEW' ? '1000' : '3000') + '}');
    if (priceMin || priceMax) {
      filterParts.push('price:[' + (priceMin || '0') + '..' + (priceMax || '') + ']');
      filterParts.push('priceCurrency:USD');
    }

    let searchPath = '/buy/browse/v1/item_summary/search?q=' + encodeURIComponent(searchQuery) +
      '&limit=' + limit + '&offset=' + offset +
      '&filter=' + encodeURIComponent(filterParts.join(','));
    if (sort) searchPath += '&sort=' + encodeURIComponent(sort);

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

    let products = items.map(item => {
      // imagen principal
      const mainImage = (item.image && item.image.imageUrl) || '';
      // imágenes adicionales (thumbnailImages) -> para carrusel
      const extraImages = (item.thumbnailImages || [])
        .map(t => t.imageUrl)
        .filter(url => url && url !== mainImage);
      const allImages = mainImage ? [mainImage, ...extraImages] : extraImages;

      // "Hacer oferta" solo aparece si el listado acepta BEST_OFFER en eBay
      const listingType = (item.buyingOptions || []).includes('BEST_OFFER') ? 'offer' : 'buy';

      return {
        id: item.itemId,
        title: item.title,
        price: item.price ? parseFloat(item.price.value) : 0,
        condition: item.condition || 'Used',
        listingType,
        image: mainImage,
        images: allImages, // array completo para el carrusel
        seller: (item.seller && item.seller.username) || '',
        itemWebUrl: '' // nunca se expone el enlace de origen
      };
    });

    // Segmento BROKEN: filtro adicional de seguridad por si eBay no fue exacto con la query
    if (brokenOnly) {
      products = products.filter(p => /broken/i.test(p.title));
    }

    return res.status(200).json({
      success: true,
      brokenMode: brokenOnly,
      total: searchRes.total || products.length,
      products
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Fetch failed', detail: String(e) });
  }
};
