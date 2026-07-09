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

function stripHtml(h) {
  return (h || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

// ── TRADUCCIÓN AUTOMÁTICA (Google Translate gratuito) ──
function translateChunk(text) {
  return new Promise((resolve) => {
    if (!text || !text.trim()) return resolve(text);
    const q = encodeURIComponent(text);
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
        } catch (e) { resolve(text); } // si falla, devuelve el original
      });
    });
    req.on('error', () => resolve(text));
    req.end();
  });
}

async function translate(text, maxLen) {
  if (!text) return '';
  text = text.slice(0, maxLen || 2000);
  // Dividir en trozos de ~1500 caracteres para no exceder límites de URL
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= 1500) { chunks.push(remaining); break; }
    let cut = remaining.lastIndexOf('. ', 1500);
    if (cut < 500) cut = 1500;
    chunks.push(remaining.slice(0, cut + 1));
    remaining = remaining.slice(cut + 1);
  }
  const results = await Promise.all(chunks.map(c => translateChunk(c)));
  return results.join(' ').trim();
}

// ── DICCIONARIO para nombres de especificaciones (rápido, sin API) ──
const SPEC_NAMES = {
  'Brand': 'Marca', 'Processor': 'Procesador', 'Processor Speed': 'Velocidad del procesador',
  'RAM Size': 'Memoria RAM', 'Ram Size': 'Memoria RAM', 'Memory': 'Memoria',
  'SSD Capacity': 'Capacidad SSD', 'Hard Drive Capacity': 'Capacidad de disco',
  'Storage Type': 'Tipo de almacenamiento', 'Operating System': 'Sistema operativo',
  'Screen Size': 'Tamaño de pantalla', 'Model': 'Modelo', 'Series': 'Serie',
  'Color': 'Color', 'Type': 'Tipo', 'Features': 'Características',
  'GPU': 'GPU', 'Graphics Processing Type': 'Tipo de gráficos',
  'Maximum Resolution': 'Resolución máxima', 'Condition': 'Estado',
  'Connectivity': 'Conectividad', 'Item Height': 'Altura', 'Item Width': 'Ancho',
  'Release Year': 'Año de lanzamiento', 'Product Line': 'Línea de producto',
  'Manufacturer Warranty': 'Garantía del fabricante', 'Unit Type': 'Tipo de unidad',
  'Country/Region of Manufacture': 'País de fabricación', 'MPN': 'Número de parte',
  'Battery Life': 'Duración de batería', 'Webcam': 'Cámara web', 'Touchscreen': 'Pantalla táctil'
};

const CONDITIONS = {
  'New': 'Nuevo', 'Used': 'Usado', 'Refurbished': 'Reacondicionado',
  'Excellent - Refurbished': 'Excelente - Reacondicionado',
  'Very Good - Refurbished': 'Muy Bueno - Reacondicionado',
  'Good - Refurbished': 'Bueno - Reacondicionado',
  'Certified - Refurbished': 'Certificado - Reacondicionado',
  'Seller refurbished': 'Reacondicionado por el vendedor',
  'For parts or not working': 'Para repuestos o no funciona',
  'Open box': 'Caja abierta', 'New (Other)': 'Nuevo (Otro)', 'New other (see details)': 'Nuevo (ver detalles)'
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const ID = process.env.EBAY_CLIENT_ID;
  const SECRET = process.env.EBAY_CLIENT_SECRET;
  if (!ID || !SECRET) return res.status(500).json({ success: false, error: 'Missing credentials' });

  const itemId = req.query.id;
  if (!itemId) return res.status(400).json({ success: false, error: 'Missing id' });

  try {
    // 1. Token OAuth de eBay
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

    // 2. Detalles del producto desde eBay
    const item = await request({
      hostname: 'api.ebay.com',
      path: '/buy/browse/v1/item/' + encodeURIComponent(itemId),
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + token.access_token,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
      }
    });

    if (!item || !item.itemId) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    // 3. Fechas estimadas de entrega
    let minDelivery = null, maxDelivery = null;
    (item.shippingOptions || []).forEach(s => {
      if (s.maxEstimatedDeliveryDate && (!maxDelivery || s.maxEstimatedDeliveryDate > maxDelivery)) maxDelivery = s.maxEstimatedDeliveryDate;
      if (s.minEstimatedDeliveryDate && (!minDelivery || s.minEstimatedDeliveryDate < minDelivery)) minDelivery = s.minEstimatedDeliveryDate;
    });

    // 4. Textos limpios en inglés
    const condDescEn = item.conditionDescription ? stripHtml(item.conditionDescription).slice(0, 400) : '';
    const descEn = item.description ? stripHtml(item.description).slice(0, 1800) : (item.shortDescription ? stripHtml(item.shortDescription).slice(0, 600) : '');

    // 5. TRADUCIR al español (en paralelo)
    const [condDescEs, descEs] = await Promise.all([
      condDescEn ? translate(condDescEn, 400) : Promise.resolve(''),
      descEn ? translate(descEn, 1800) : Promise.resolve('')
    ]);

    // 6. Traducir estado y nombres de specs con diccionario
    const conditionEs = CONDITIONS[item.condition] || item.condition || 'Usado';
    const specs = (item.localizedAspects || []).map(a => ({
      name: SPEC_NAMES[a.name] || a.name,
      value: a.value
    }));

    return res.status(200).json({
      success: true,
      item: {
        id: item.itemId,
        title: item.title,
        condition: conditionEs,
        conditionDescription: condDescEs,
        description: descEs,
        specs,
        minDelivery,
        maxDelivery,
        image: (item.image && item.image.imageUrl) || '',
        itemUrl: item.itemWebUrl || ''
      }
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Fetch failed', detail: String(e) });
  }
};
