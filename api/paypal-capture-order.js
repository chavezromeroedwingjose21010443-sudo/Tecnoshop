// api/paypal-capture-order.js
// Confirma (captura) el pago de una orden de PayPal ya aprobada por el cliente.
// El frontend llama a este endpoint justo después de que PayPal confirma la aprobación.

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
    const { orderId } = req.body || {};
    if (!orderId) return res.status(400).json({ success: false, error: 'Falta el ID de la orden' });

    const accessToken = await getAccessToken();
    if (!accessToken) return res.status(500).json({ success: false, error: 'No se pudo autenticar con PayPal' });

    const capture = await request({
      hostname: getHost(),
      path: '/v2/checkout/orders/' + encodeURIComponent(orderId) + '/capture',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
        'Content-Length': 0
      }
    }, '');

    const status = capture.status;
    const captureId = capture.purchase_units &&
      capture.purchase_units[0] &&
      capture.purchase_units[0].payments &&
      capture.purchase_units[0].payments.captures &&
      capture.purchase_units[0].payments.captures[0] &&
      capture.purchase_units[0].payments.captures[0].id;

    if (status !== 'COMPLETED') {
      return res.status(400).json({ success: false, error: 'El pago no se completó', status });
    }

    return res.status(200).json({ success: true, status, captureId, orderId });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Fallo al capturar el pago', detail: String(e) });
  }
};