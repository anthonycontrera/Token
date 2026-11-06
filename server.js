require('dotenv').config();
const express = require('express');
const path = require('path');

const {
  PRIVATE_KEY, PUBLIC_KEY, PORT = 3000, AUTH_MODE = 'raw',
  //test
  // BASE_URL = 'https://labservicios.cardnet.com.do/servicios/tokens/v1',
  //PRO
  BASE_URL = 'https://servicios.cardnet.com.do/servicios/tokens/v1',
} = process.env;

if (!PRIVATE_KEY || !PUBLIC_KEY) {
  console.error('Falta PRIVATE_KEY o PUBLIC_KEY en .env (copia .env.example a .env)');
  process.exit(1);
}

const AUTH = 'Basic ' + (AUTH_MODE === 'b64'
  ? Buffer.from(PRIVATE_KEY + ':').toString('base64')
  : PRIVATE_KEY);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Llamada a CardNET con la private key (nunca llega al navegador)
async function cardnet(res, method, endpoint, body) {
  try {
    const r = await fetch(`${BASE_URL}/api${endpoint}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: AUTH },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    console.log(method, endpoint, '->', r.status);
    res.status(r.status).json(data);
  } catch (e) {
    res.status(502).json({ proxyError: e.message });
  }
}

// Solo datos públicos para el navegador
app.get('/api/config', (_req, res) => res.json({
  publicKey: PUBLIC_KEY,

  // SDK oficial de producción
  scriptUrl: `https://tr-tsp.gtp-seglan.com/tr-tsp-mw-cardnet/v1/Scripts/PWCheckout.js?key=${PUBLIC_KEY}`,

  // Endpoint REST de captura: conservar temporalmente
  captureUrl: `${BASE_URL}/Capture/`,
}));

// 1. Crear Customer
app.post('/api/customers', (req, res) =>
  cardnet(res, 'POST', '/Customer', { Enable: 'true', ...req.body }));

// 2. Consultar Customer (devuelve UniqueID nuevo + PaymentProfiles con sus tokens)
app.get('/api/customers/:id', (req, res) =>
  cardnet(res, 'GET', `/Customer/${encodeURIComponent(req.params.id)}`));

// 3. Activar perfil de pago
app.post('/api/customers/:id/activate', (req, res) => {
  const { Token, ActivationCode } = req.body;
  cardnet(res, 'POST', `/Customer/${encodeURIComponent(req.params.id)}/activate`, { Token, ActivationCode });
});

// 4. Compra con token
app.post('/api/purchase', (req, res) => {
  const b = req.body;
  cardnet(res, 'POST', '/Purchase', {
    TrxToken: b.TrxToken,
    Order: b.Order,
    Amount: Number(b.Amount),
    Tip: Number(b.Tip) || 0,
    Currency: b.Currency || 'DOP',
    Capture: b.Capture !== false && b.Capture !== 'false',
    CustomerIP: b.CustomerIP || req.ip,
    DataDo: { Tax: String(b.Tax ?? '0'), Invoice: String(b.Invoice) },
  });
}); // <--- ¡Aquí se cierra correctamente app.post('/api/purchase')!

// 5. Reembolso / Devolución (Refund)
app.post('/api/refund', (req, res) => {
  const b = req.body;
  cardnet(res, 'POST', '/Refund', {
    TransactionId: b.TransactionId, // ID de la transacción original a reembolsar
    Amount: Number(b.Amount),       // Monto a devolver
    Currency: b.Currency || 'DOP',
    Reason: b.Reason || 'Solicitud del cliente'
  });
});

app.listen(PORT, () => console.log(`http://localhost:${PORT}  (${BASE_URL})`));