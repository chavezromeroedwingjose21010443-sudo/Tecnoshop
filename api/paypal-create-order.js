// api/paypal-create-order.js
// Crea una orden de PayPal para el monto del pedido actual.
// El frontend llama a este endpoint cuando el cliente hace clic en el botón de PayPal.

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

// PAYPAL_MODE debe ser "sandbox" o "live" (variable de entorno en Vercel)
function getHost() {
  return process.env.PAYPAL_MODE === 'live' ? 'api-m.paypal.com' : 'api-m.sandbox.paypal.com';
}

async function getAccessToken() {
  const ID = process.env.PAYPAL_CLIENT_ID;
  const SECRET = process.env.PAYPAL_CLIENT_SECRET;
  const creds = Buffer.from(ID + ':' + SECRET).toString('base64');
  const body = 'grant_type=client_credentials';
  const res = await request({
    hostname: getHost(),
    path: '/v1/oauth2/token',
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + creds,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body)
    }
  }, body);
  return res.access_token;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const ID = process.env.PAYPAL_CLIENT_ID;
  const SECRET = process.env.PAYPAL_CLIENT_SECRET;
  if (!ID || !SECRET) return res.status(500).json({ success: false, error: 'Missing PayPal credentials' });

  try {
    const { total } = req.body || {};
    const amount = parseFloat(total);
    if (!amount || amount <= 0) return res.status(400).json({ success: false, error: 'Monto inválido' });

    const accessToken = await getAccessToken();
    if (!accessToken) return res.status(500).json({ success: false, error: 'No se pudo autenticar con PayPal' });

    const orderBody = JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: { currency_code: 'USD', value: amount.toFixed(2) },
        description: 'Pedido TecnoShop'
      }]
    });

    const order = await request({
      hostname: getHost(),
      path: '/v2/checkout/orders',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(orderBody)
      }
    }, orderBody);

    if (!order.id) return res.status(500).json({ success: false, error: 'No se pudo crear la orden de PayPal' });

    return res.status(200).json({ success: true, orderId: order.id });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Fallo al crear orden', detail: String(e) });
  }
};
