// api/ebay.js
// Busca productos en eBay Browse API y devuelve datos limpios para TecnoShop.
// Solo muestra productos de vendedores de confianza previamente seleccionados.
// Incluye imagen principal + imágenes adicionales (para carrusel en el frontend).

const https = require('https');

// ── VENDEDORES DE CONFIANZA (laptops + proveedores de piezas) ──
const TRUSTED_SELLERS = [
  // Laptops (originales)
  'discounttechdirect',
  'merresale',
  'paymore_doraville',
  'dtd_electronicsplus',
  // Piezas y repuestos (nuevos)
  'firesale-deals',
  'miller_sells_it_llc',
  'vvanmenghangzhouchua_0',
  'omaha_blue',
  'spcpart',
  'lakemichigancomputers',
  'champion-laptop-battery-store'
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

// ── TRADUCCIÓN AUTOMÁTICA DE TÍTULOS (Google Translate gratuito) ──
// Traduce cada título de inglés a español. Si falla, devuelve el texto original
// para nunca romper el listado por un error de traducción puntual.
function translateTitle(text) {
  return new Promise((resolve) => {
    if (!text || !text.trim()) return resolve(text);
    const q = encodeURIComponent(text.slice(0, 300));
    const path = '/translate_a/single?client=gtx&sl=en&tl=es&dt=t&q=' + q;
    const req = https.request({
      hostname: 'translate.googleapis.com',
      path,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(d);
          const translated = (parsed[0] || []).map(seg => seg[0]).join('');
          resolve(translated || text);
        } catch (e) { resolve(text); }
      });
    });
    req.on('error', () => resolve(text));
    req.setTimeout(3000, () => { req.destroy(); resolve(text); }); // no bloquear el listado si tarda
    req.end();
  });
}

// ═══ MOTOR DE PRECIOS POR CATEGORÍA ═══
// Detecta el tipo de producto por palabras clave del título y devuelve
// el precio final de venta ya calculado según las reglas de negocio de TecnoShop.
const MARKUP_DEFAULT = 105; // laptop individual normal

function detectCategoryAndPrice(title, cost, condition) {
  const t = (title || '').toUpperCase();

  // 1. LOTES: "LOT OF 2", "LOT OF 3", etc. — precio fijo escalonado, ignora costo eBay
  const lotMatch = t.match(/LOT\s+OF\s+(\d+)/);
  if (lotMatch) {
    const qty = parseInt(lotMatch[1], 10);
    if (qty >= 2) {
      const price = 155 + Math.max(0, qty - 2) * 20; // 2=155, 3=175, 4=195...
      return { category: 'lot', label: 'Lote de ' + qty, price: Math.round(price * 100) / 100 };
    }
  }

  // 2. TARJETA MADRE: costo + 150%
  if (/MOTHERBOARD|MOTHER\s*BOARD|SYSTEM\s*BOARD|MAINBOARD/.test(t)) {
    return { category: 'motherboard', label: 'Tarjeta madre', price: Math.round(cost * 2.5 * 100) / 100 };
  }

  // 3. BATERÍA: distingue genuina/OEM (más cara) vs genérica
  if (/BATTERY|BATTERIA/.test(t)) {
    const isGenuine = /GENUINE|OEM|ORIGINAL/.test(t);
    const multiplier = isGenuine ? 2.5 : 1.75; // genuina costo+150%, genérica costo+75%
    return {
      category: 'battery',
      label: isGenuine ? 'Batería original/OEM' : 'Batería genérica',
      price: Math.round(cost * multiplier * 100) / 100
    };
  }

  // 4. TECLADO: costo + 100%
  if (/KEYBOARD/.test(t)) {
    return { category: 'keyboard', label: 'Teclado', price: Math.round(cost * 2 * 100) / 100 };
  }

  // 5. NO FUNCIONA / PARA REPUESTOS: se decide por la CONDICIÓN REAL de eBay
  // (el estado que aparece en "Acerca de este artículo"), nunca por palabras del título.
  if (condition === 'For parts or not working') {
    return { category: 'parts', label: '⚠️ Dañados, no funcionan', price: Math.round((cost + MARKUP_DEFAULT) * 100) / 100 };
  }

  // 5. Producto normal (laptop individual, etc.): costo + markup fijo
  return { category: 'standard', label: '', price: Math.round((cost + MARKUP_DEFAULT) * 100) / 100 };
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
    if (condition) {
      const condMap = { NEW: '1000', USED: '3000', PARTS: '7000' };
      filterParts.push('conditionIds:{' + (condMap[condition] || '3000') + '}');
    }
    if (priceMin || priceMax) {
      filterParts.push('price:[' + (priceMin || '0') + '..' + (priceMax || '') + ']');
      filterParts.push('priceCurrency:USD');
    }

    let searchPath = '/buy/browse/v1/item_summary/search?q=' + encodeURIComponent(q) +
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

    // Mapa de conditionId (código numérico que eBay SIEMPRE incluye) a texto legible,
    // usado como respaldo confiable cuando "condition" (texto) no viene en la respuesta.
    const CONDITION_ID_MAP = {
      '1000': 'New',
      '1500': 'New other (see details)',
      '1750': 'New with defects',
      '2000': 'Certified - Refurbished',
      '2010': 'Excellent - Refurbished',
      '2020': 'Very Good - Refurbished',
      '2030': 'Good - Refurbished',
      '2500': 'Seller refurbished',
      '2750': 'Like New',
      '3000': 'Used',
      '4000': 'Very Good',
      '5000': 'Good',
      '6000': 'Acceptable',
      '7000': 'For parts or not working'
    };

    const products = items.map(item => {
      // imagen principal
      const mainImage = (item.image && item.image.imageUrl) || '';
      // imágenes adicionales (thumbnailImages) -> para carrusel
      const extraImages = (item.thumbnailImages || [])
        .map(t => t.imageUrl)
        .filter(url => url && url !== mainImage);
      const allImages = mainImage ? [mainImage, ...extraImages] : extraImages;

      // "Hacer oferta" solo aparece si el listado acepta BEST_OFFER en eBay
      const listingType = (item.buyingOptions || []).includes('BEST_OFFER') ? 'offer' : 'buy';

      const cost = item.price ? parseFloat(item.price.value) : 0;

      // La condición en texto no siempre viene en la búsqueda; usamos conditionId como respaldo real
      // en vez de asumir "Used" por defecto, que era la causa de que todo apareciera como usado.
      const condition = item.condition || CONDITION_ID_MAP[item.conditionId] || 'Used';

      const pricing = detectCategoryAndPrice(item.title, cost, condition);

      return {
        id: item.itemId,
        title: item.title,
        price: cost, // costo real en eBay (base para ofertas y cálculos internos)
        finalPrice: pricing.price, // precio de venta ya calculado según categoría
        category: pricing.category,
        categoryLabel: pricing.label,
        condition,
        listingType,
        image: mainImage,
        images: allImages, // array completo para el carrusel
        seller: (item.seller && item.seller.username) || '',
        itemWebUrl: '' // nunca se expone el enlace de origen
      };
    });

    // Traducir todos los títulos en paralelo (con timeout individual de 3s por título,
    // así una traducción lenta nunca bloquea el listado completo)
    await Promise.all(products.map(async (p) => {
      p.titleEn = p.title; // se conserva el original en inglés por si se necesita
      p.title = await translateTitle(p.title);
    }));

    return res.status(200).json({
      success: true,
      total: searchRes.total || products.length,
      products
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Fetch failed', detail: String(e) });
  }
};
