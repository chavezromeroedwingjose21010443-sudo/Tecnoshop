// api/paypal-create-order.js
// Crea una orden de PayPal para el monto del pedido actual.
// El frontend llama a este endpoint cuando el cliente hace clic en el botón de PayPal.

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

// PAYPAL_MODE debe ser "sandbox" o "live" (variable de entorno en Vercel)
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
    // Devolvemos el error REAL que PayPal envió, en vez de esconderlo
    const reason = (data && (data.error_description || data.error)) || raw || ('HTTP ' + status);
    return { token: null, error: reason };
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
  if (!ID || !SECRET) return res.status(500).json({ success: false, error: 'Faltan las credenciales de PayPal en el servidor (variables de entorno no configuradas)' });

  try {
    const { total, savedPaymentTokenId } = req.body || {};
    const amount = parseFloat(total);
    if (!amount || amount <= 0) return res.status(400).json({ success: false, error: 'Monto inválido' });

    const { token: accessToken, error: tokenError } = await getAccessToken();
    if (!accessToken) {
      return res.status(500).json({ success: false, error: 'PayPal rechazó la autenticación', detail: tokenError });
    }

    const orderPayload = {
      intent: 'CAPTURE',
      purchase_units: [{
        amount: { currency_code: 'USD', value: amount.toFixed(2) },
        description: 'Pedido TecnoShop'
      }]
    };

    // Si el cliente tiene un método de pago guardado y lo eligió, la orden se paga
    // directamente con ese token — el cliente solo confirma (Face ID / huella / código),
    // sin volver a mostrar el flujo completo de PayPal.
    if (savedPaymentTokenId) {
      orderPayload.payment_source = {
        paypal: {
          vault_id: savedPaymentTokenId,
          experience_context: {
            return_url: 'https://tecnoshop-theta.vercel.app',
            cancel_url: 'https://tecnoshop-theta.vercel.app'
          }
        }
      };
    }

    const orderBody = JSON.stringify(orderPayload);

    const { status: orderStatus, data: order, raw: orderRaw } = await request({
      hostname: getHost(),
      path: '/v2/checkout/orders',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(orderBody)
      }
    }, orderBody);

    if (!order || !order.id) {
      const reason = (order && (order.message || order.details)) || orderRaw || ('HTTP ' + orderStatus);
      return res.status(500).json({ success: false, error: 'PayPal no pudo crear la orden', detail: typeof reason === 'string' ? reason : JSON.stringify(reason) });
    }

    // Si se pagó con token guardado, PayPal puede completar el pago de inmediato (status COMPLETED)
    // sin necesitar el paso de aprobación/captura por separado.
    const alreadyCompleted = order.status === 'COMPLETED';

    return res.status(200).json({ success: true, orderId: order.id, alreadyCompleted });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Fallo al crear orden', detail: String(e) });
  }
};
