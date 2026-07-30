// api/paypal-setup-token.js
// Crea un "setup token" (para preparar el guardado) y, tras la aprobación del cliente,
// lo convierte en un "payment token" reutilizable que se guarda en Firestore
// (esto lo hace el frontend, aquí solo se generan/consultan los tokens de PayPal).

const https = require('https');

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(d) });
        } catch (e) {
          resolve({ status: res.statusCode, data: null, raw: d });
        }
      });
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
  const { status, data, raw } = await request({
    hostname: getHost(),
    path: '/v1/oauth2/token',
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + creds,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body)
    }
  }, body);
  if (status !== 200 || !data || !data.access_token) {
    return { token: null, error: (data && (data.error_description || data.error)) || raw || ('HTTP ' + status) };
  }
  return { token: data.access_token, error: null };
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
  if (!ID || !SECRET) return res.status(500).json({ success: false, error: 'Faltan las credenciales de PayPal en el servidor' });

  try {
    const { action, setupTokenId, customerId } = req.body || {};
    const { token: accessToken, error: tokenError } = await getAccessToken();
    if (!accessToken) {
      return res.status(500).json({ success: false, error: 'PayPal rechazó la autenticación', detail: tokenError });
    }

    if (action === 'create-setup-token') {
      // Paso 1: crear el "setup token" que el botón de PayPal usa para pedir la aprobación del cliente
      const body = JSON.stringify({
        payment_source: {
          paypal: {
            usage_pattern: 'IMMEDIATE',
            experience_context: {
              return_url: 'https://tecnoshop-theta.vercel.app',
              cancel_url: 'https://tecnoshop-theta.vercel.app'
            }
          }
        }
      });
      const { status, data, raw } = await request({
        hostname: getHost(),
        path: '/v3/vault/setup-tokens',
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + accessToken,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      }, body);
      if (status >= 400 || !data || !data.id) {
        return res.status(500).json({ success: false, error: 'No se pudo crear el setup token', detail: raw || JSON.stringify(data) });
      }
      return res.status(200).json({ success: true, setupTokenId: data.id });
    }

    if (action === 'create-payment-token') {
      // Paso 2: una vez el cliente aprobó, convertir el setup token en un payment token permanente
      if (!setupTokenId) return res.status(400).json({ success: false, error: 'Falta el setupTokenId' });
      const body = JSON.stringify({ payment_source: { token: { id: setupTokenId, type: 'SETUP_TOKEN' } } });
      const { status, data, raw } = await request({
        hostname: getHost(),
        path: '/v3/vault/payment-tokens',
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + accessToken,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      }, body);
      if (status >= 400 || !data || !data.id) {
        return res.status(500).json({ success: false, error: 'No se pudo guardar el método de pago', detail: raw || JSON.stringify(data) });
      }
      // Se devuelve el ID del payment token — esto es lo único que se guarda en Firestore,
      // nunca datos reales de tarjeta o cuenta.
      return res.status(200).json({ success: true, paymentTokenId: data.id });
    }

    return res.status(400).json({ success: false, error: 'Acción no reconocida' });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Fallo en setup token', detail: String(e) });
  }
};