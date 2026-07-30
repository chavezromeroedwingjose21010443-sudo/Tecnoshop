// api/paypal-generate-token.js
// Genera un "id_token" de cliente en PayPal, necesario para poder guardar
// su método de pago (vaulting) vinculado a su cuenta de TecnoShop.
// Se llama UNA VEZ al abrir el checkout, antes de mostrar el botón de PayPal.

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
    const { customerId } = req.body || {};
    if (!customerId) return res.status(400).json({ success: false, error: 'Falta el identificador del cliente' });

    const { token: accessToken, error: tokenError } = await getAccessToken();
    if (!accessToken) {
      return res.status(500).json({ success: false, error: 'PayPal rechazó la autenticación', detail: tokenError });
    }

    // Genera el id_token vinculado a ESTE cliente específico (usamos su UID de Firebase como referencia)
    const tokenBody = 'grant_type=client_credentials&response_type=id_token&target_customer_id=' + encodeURIComponent(customerId);
    const { status, data, raw } = await request({
      hostname: getHost(),
      path: '/v1/oauth2/token',
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(ID + ':' + SECRET).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(tokenBody)
      }
    }, tokenBody);

    if (status !== 200 || !data || !data.id_token) {
      const reason = (data && (data.error_description || data.error)) || raw || ('HTTP ' + status);
      return res.status(500).json({ success: false, error: 'No se pudo generar el token de cliente', detail: reason });
    }

    return res.status(200).json({ success: true, idToken: data.id_token });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Fallo al generar token', detail: String(e) });
  }
};
