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

const authRoutes = require('./routes/auth');
const publicRoutes = require('./routes/public');
const restaurantRoutes = require('./routes/restaurant');
const adminRoutes = require('./routes/admin');

const app = express();
const PUBLIC_DIR = path.join(config.root, 'public');

app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '256kb' }));

// Baseline hardening. The app ships no third-party scripts, so the CSP can be tight.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; " +
      "script-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'"
  );
  next();
});

app.use(attachUser);

// --- API ------------------------------------------------------------------
app.get('/api/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));
app.use('/api/auth', authRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/rest', restaurantRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', notFoundHandler);

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
  app.listen(config.port, () => {
    console.log(`\n  Menu — QR ordering platform`);
    console.log(`  ---------------------------------------------`);
    console.log(`  Guest / landing   ${config.publicBaseUrl}/`);
    console.log(`  Staff login       ${config.publicBaseUrl}/login`);
    console.log(`  Restaurant admin  ${config.publicBaseUrl}/dashboard/`);
    console.log(`  Platform admin    ${config.publicBaseUrl}/admin/`);
    console.log(`  Database          ${config.databaseFile}\n`);
  });
}

module.exports = app;
