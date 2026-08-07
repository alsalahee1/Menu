'use strict';

const path = require('path');
const express = require('express');

const config = require('./config');
const { migrate } = require('./db');

// The schema must exist before any module prepares a statement against it,
// so migration runs ahead of the route requires below.
migrate();

const { attachUser } = require('./middleware/auth');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { rateLimit } = require('./middleware/rateLimit');

const authRoutes = require('./routes/auth');
const publicRoutes = require('./routes/public');
const restaurantRoutes = require('./routes/restaurant');
const adminRoutes = require('./routes/admin');
const uploadRoutes = require('./routes/uploads');

const app = express();
const PUBLIC_DIR = path.join(config.root, 'public');

app.disable('x-powered-by');
// Behind a load balancer this must be set correctly, or every request appears
// to come from the proxy and the rate limiter becomes a global counter.
app.set('trust proxy', config.trustProxy);

// --- Security headers -----------------------------------------------------
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; " +
      "script-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'"
  );

  if (config.forceHttps) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (req.protocol !== 'https') {
      return res.redirect(308, `https://${req.get('host')}${req.originalUrl}`);
    }
  }
  return next();
});

// attachUser only reads headers, so it is safe ahead of any body parser — and
// it must come first, or the upload route below would see no signed-in user.
app.use(attachUser);

// Uploads carry a raw image body, so they are routed before the JSON parser
// rather than after it.
app.use('/api/uploads', uploadRoutes);

app.use(express.json({ limit: '256kb' }));

// --- Rate limits ----------------------------------------------------------
// Tight where an anonymous caller can create rows or guess credentials,
// generous everywhere else so normal dashboard use is never throttled.
const limits = {
  api: rateLimit({ name: 'api', windowMs: 60_000, max: 600 }),
  login: rateLimit({
    name: 'login',
    windowMs: 15 * 60_000,
    max: 20,
    message: 'Too many sign-in attempts. Please wait a few minutes and try again.',
  }),
  placeOrder: rateLimit({
    name: 'order',
    windowMs: 10 * 60_000,
    max: 20,
    message: 'You have placed several orders in a short time. Please wait a moment or ask a staff member.',
  }),
  serviceRequest: rateLimit({ name: 'service', windowMs: 10 * 60_000, max: 30 }),
  payment: rateLimit({
    name: 'payment',
    windowMs: 10 * 60_000,
    max: 30,
    message: 'Too many payment attempts. Please wait a moment.',
  }),
  lead: rateLimit({ name: 'lead', windowMs: 60 * 60_000, max: 5 }),
};

app.use('/api', limits.api);
app.post('/api/auth/login', limits.login);
app.post('/api/public/orders', limits.placeOrder);
app.post('/api/public/service-requests', limits.serviceRequest);
app.post('/api/public/signup-interest', limits.lead);
app.use('/api/public/orders/:code/pay', limits.payment);
app.use('/api/public/payments', limits.payment);

// --- API ------------------------------------------------------------------
app.get('/api/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));
app.use('/api/auth', authRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/rest', restaurantRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', notFoundHandler);

// --- Uploaded images ------------------------------------------------------
// Served with nosniff and a fixed disposition so a crafted file can never be
// interpreted as a document in the app's own origin.
app.use(
  '/uploads',
  express.static(config.uploadDir, {
    maxAge: '30d',
    immutable: true,
    index: false,
    dotfiles: 'deny',
    setHeaders(res) {
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    },
  })
);

// --- Static assets --------------------------------------------------------
app.use(
  express.static(PUBLIC_DIR, {
    extensions: ['html'],
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

// --- Friendly guest URLs --------------------------------------------------
const page = (file) => (_req, res) => res.sendFile(path.join(PUBLIC_DIR, file));

// The address printed on the QR sticker: /t/<restaurant-slug>/<table-code>
app.get('/t/:slug/:table', page('menu.html'));
// Browse a menu without a table (takeaway / preview)
app.get('/r/:slug', page('menu.html'));
app.get('/order/:code', page('order.html'));
app.get('/orders', page('orders.html'));
app.get('/login', page('login.html'));

// Unknown non-API path → landing page.
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  return res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
});

app.use(errorHandler);

if (require.main === module) {
  const server = app.listen(config.port, () => {
    const payments = require('./services/payments');
    console.log(`\n  Menu — QR ordering platform`);
    console.log(`  ---------------------------------------------`);
    console.log(`  Guest / landing   ${config.publicBaseUrl}/`);
    console.log(`  Staff login       ${config.publicBaseUrl}/login`);
    console.log(`  Restaurant admin  ${config.publicBaseUrl}/dashboard/`);
    console.log(`  Platform admin    ${config.publicBaseUrl}/admin/`);
    console.log(`  Database          ${config.databaseFile}`);
    console.log(`  Uploads           ${config.uploadDir}`);
    console.log(`  Payments          ${payments.activeProvider()}${payments.activeProvider() === 'mock' ? ' (simulated — no real money moves)' : ''}\n`);
  });

  // Finish in-flight requests before exiting so a rolling deploy never drops
  // an order mid-write.
  const shutdown = (signal) => {
    console.log(`\n[server] ${signal} received, shutting down…`);
    server.close(() => {
      try {
        require('./db').db.close();
      } catch {
        /* already closed */
      }
      process.exit(0);
    });
    // Do not hang forever on a stuck SSE connection.
    setTimeout(() => process.exit(0), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = app;
