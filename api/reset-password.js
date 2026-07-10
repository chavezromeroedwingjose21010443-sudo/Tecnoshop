// api/reset-password.js
// Genera un link de recuperación de contraseña con Firebase Admin
// y lo devuelve para que el frontend lo envíe con EmailJS (correo con logo TecnoShop).
//
// Variables de entorno necesarias en Vercel:
//   FIREBASE_PROJECT_ID
//   FIREBASE_CLIENT_EMAIL
//   FIREBASE_PRIVATE_KEY   (con los \n literales, ver instrucciones abajo)

const admin = require('firebase-admin');

function getAdminApp() {
  if (admin.apps.length) return admin.app();

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // En Vercel las variables de entorno no preservan saltos de línea reales,
  // así que la private key se guarda con "\n" literales y aquí se convierten.
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  return admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey })
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  try {
    const { email } = req.body || {};
    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      return res.status(400).json({ success: false, error: 'Correo inválido' });
    }

    getAdminApp();

    const actionCodeSettings = {
      url: 'https://tecnoshop-theta.vercel.app', // a dónde vuelve el usuario tras cambiar la contraseña
      handleCodeInApp: false
    };

    const link = await admin.auth().generatePasswordResetLink(email, actionCodeSettings);

    return res.status(200).json({ success: true, link });
  } catch (e) {
    // Por seguridad, no revelamos si el correo existe o no en mensajes públicos
    const code = e && e.code;
    if (code === 'auth/user-not-found') {
      return res.status(200).json({ success: true, link: null }); // respuesta neutra
    }
    return res.status(500).json({ success: false, error: 'No se pudo generar el enlace' });
  }
};
