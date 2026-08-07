'use strict';

const express = require('express');
const QRCode = require('qrcode');
const config = require('../config');
const { db } = require('../db');
const { getMenu } = require('../services/menu');
const orders = require('../services/orders');
const payments = require('../services/payments');
const events = require('../lib/events');
const { str, int, oneOf, email } = require('../lib/validate');
const { notFound, badRequest, conflict, forbidden } = require('../lib/errors');

const router = express.Router();

function publicRestaurant(row) {
  return {
    id: row.id,
    name: row.name,
    name_ar: row.name_ar,
    slug: row.slug,
    description: row.description,
    description_ar: row.description_ar,
    cuisine: row.cuisine,
    logo_url: row.logo_url,
    cover_url: row.cover_url,
    phone: row.phone,
    address: row.address,
    currency: row.currency,
    tax_rate: row.tax_rate,
    service_charge_rate: row.service_charge_rate,
    primary_color: row.primary_color,
    accepts_orders: !!row.accepts_orders && row.status === 'active',
    online_payments_enabled: !!row.online_payments_enabled,
    opening_hours: row.opening_hours,
    status: row.status,
  };
}

function loadActiveRestaurant(slug) {
  const row = db.prepare('SELECT * FROM restaurants WHERE slug = ?').get(String(slug).toLowerCase());
  if (!row) throw notFound('We could not find that restaurant');
  if (row.status === 'suspended') throw forbidden('This restaurant is not available right now');
  return row;
}

/** Directory of live restaurants — powers the demo landing page. */
router.get('/restaurants', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT r.*, (SELECT COUNT(*) FROM menu_items m WHERE m.restaurant_id = r.id AND m.is_available = 1) AS item_count,
              (SELECT ROUND(AVG(rating),1) FROM reviews rv WHERE rv.restaurant_id = r.id) AS avg_rating,
              (SELECT t.code FROM tables t WHERE t.restaurant_id = r.id AND t.status != 'inactive' ORDER BY t.id LIMIT 1) AS sample_table
         FROM restaurants r
        WHERE r.status = 'active'
        ORDER BY r.name`
    )
    .all();

  res.json({
    restaurants: rows.map((r) => ({
      ...publicRestaurant(r),
      item_count: r.item_count,
      avg_rating: r.avg_rating,
      sample_table: r.sample_table,
    })),
  });
});

/** Everything the guest menu page needs in a single round trip. */
router.get('/r/:slug', (req, res, next) => {
  try {
    const restaurant = loadActiveRestaurant(req.params.slug);
    const menu = getMenu(restaurant.id, { publicOnly: true });

    // Hide empty categories from guests, but keep available items visible.
    const categories = menu.categories
      .map((c) => ({ ...c, items: c.items.filter((i) => i.is_available || i.is_available === false) }))
      .filter((c) => c.items.length > 0);

    const reviews = db
      .prepare('SELECT rating, comment, created_at FROM reviews WHERE restaurant_id = ? ORDER BY id DESC LIMIT 8')
      .all(restaurant.id);

    res.json({
      restaurant: publicRestaurant(restaurant),
      categories,
      reviews,
    });
  } catch (err) {
    next(err);
  }
});

/** Validate the table code carried by the QR the guest scanned. */
router.get('/r/:slug/table/:code', (req, res, next) => {
  try {
    const restaurant = loadActiveRestaurant(req.params.slug);
    const table = db
      .prepare('SELECT id, label, code, seats, zone, status FROM tables WHERE restaurant_id = ? AND code = ?')
      .get(restaurant.id, String(req.params.code).toUpperCase());

    if (!table) throw notFound('That table code is not recognised at this restaurant');
    if (table.status === 'inactive') throw conflict('This table is out of service');

    res.json({ restaurant: publicRestaurant(restaurant), table });
  } catch (err) {
    next(err);
  }
});

/**
 * QR image for a table. The code only encodes a public URL, so this needs no
 * authentication — it is what gets printed on the table sticker.
 */
router.get('/r/:slug/table/:code/qr.svg', async (req, res, next) => {
  try {
    const restaurant = loadActiveRestaurant(req.params.slug);
    const code = String(req.params.code).toUpperCase();
    const table = db
      .prepare('SELECT id FROM tables WHERE restaurant_id = ? AND code = ?')
      .get(restaurant.id, code);
    if (!table) throw notFound('That table code is not recognised');

    const svg = await QRCode.toString(`${config.publicBaseUrl}/t/${restaurant.slug}/${code}`, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      width: int(req.query.size, 'size', { fallback: 320, min: 128, max: 1200 }),
      color: { dark: '#111111', light: '#ffffff' },
    });
    res.type('svg').set('Cache-Control', 'public, max-age=300').send(svg);
  } catch (err) {
    next(err);
  }
});

/** Place an order. Prices come from the database, never from the request. */
router.post('/orders', (req, res, next) => {
  try {
    const slug = str(req.body.slug, 'slug', { required: true, max: 80 });
    const restaurant = loadActiveRestaurant(slug);
    const type = oneOf(req.body.type, 'type', ['dine_in', 'takeaway'], { fallback: 'dine_in' });

    let tableId = null;
    if (type === 'dine_in') {
      const tableCode = str(req.body.table_code, 'table_code', { required: true, max: 20 }).toUpperCase();
      const table = db
        .prepare('SELECT id, status FROM tables WHERE restaurant_id = ? AND code = ?')
        .get(restaurant.id, tableCode);
      if (!table) throw badRequest('Unknown table code — please rescan the QR code on your table');
      if (table.status === 'inactive') throw conflict('This table is out of service');
      tableId = table.id;
    }

    const order = orders.createOrder(restaurant, {
      table_id: tableId,
      type,
      customer_name: str(req.body.customer_name, 'customer_name', { max: 80 }),
      customer_phone: str(req.body.customer_phone, 'customer_phone', { max: 40 }),
      note: str(req.body.note, 'note', { max: 500 }),
      session_id: str(req.body.session_id, 'session_id', { max: 64 }),
      items: req.body.items,
    });

    res.status(201).json({ order });
  } catch (err) {
    next(err);
  }
});

/** Public order tracking by code. */
router.get('/orders/:code', (req, res, next) => {
  try {
    const order = orders.getOrderByCode(req.params.code);
    if (!order) throw notFound('No order matches that code');
    res.json({ order });
  } catch (err) {
    next(err);
  }
});

/** Live status updates for the guest's tracking screen. */
router.get('/orders/:code/stream', (req, res, next) => {
  try {
    const code = String(req.params.code).toUpperCase();
    const exists = db.prepare('SELECT 1 FROM orders WHERE code = ?').get(code);
    if (!exists) throw notFound('No order matches that code');
    events.sseHandler(req, res, [events.orderChannel(code)]);
  } catch (err) {
    next(err);
  }
});

/** A guest's own order history, scoped to their anonymous browser session. */
router.get('/sessions/:sessionId/orders', (req, res, next) => {
  try {
    const sessionId = str(req.params.sessionId, 'sessionId', { required: true, max: 64 });
    const rows = db
      .prepare(
        `SELECT o.code, o.status, o.total, o.placed_at, o.type, r.name AS restaurant_name,
                r.slug AS restaurant_slug, r.currency, t.label AS table_label
           FROM orders o
           JOIN restaurants r ON r.id = o.restaurant_id
           LEFT JOIN tables t ON t.id = o.table_id
          WHERE o.session_id = ?
          ORDER BY o.id DESC LIMIT 40`
      )
      .all(sessionId);
    res.json({ orders: rows });
  } catch (err) {
    next(err);
  }
});

/** Guests may cancel only while the kitchen has not accepted the order yet. */
router.post('/orders/:code/cancel', (req, res, next) => {
  try {
    const order = orders.getOrderByCode(req.params.code);
    if (!order) throw notFound('No order matches that code');
    if (order.status !== 'pending') {
      throw conflict('The kitchen has already started this order — please ask a staff member to cancel it');
    }
    const updated = orders.updateStatus(order.id, 'cancelled', {
      note: str(req.body.reason, 'reason', { max: 200 }) || 'Cancelled by guest',
    });
    res.json({ order: updated });
  } catch (err) {
    next(err);
  }
});

/** "Call waiter" / "bring the bill" buttons. */
router.post('/service-requests', (req, res, next) => {
  try {
    const slug = str(req.body.slug, 'slug', { required: true, max: 80 });
    const restaurant = loadActiveRestaurant(slug);
    const type = oneOf(req.body.type, 'type', ['waiter', 'bill', 'water', 'cleanup'], { required: true });
    const tableCode = str(req.body.table_code, 'table_code', { required: true, max: 20 }).toUpperCase();

    const table = db
      .prepare('SELECT id, label FROM tables WHERE restaurant_id = ? AND code = ?')
      .get(restaurant.id, tableCode);
    if (!table) throw badRequest('Unknown table code');

    // Collapse repeat taps into the one open request.
    const existing = db
      .prepare("SELECT id FROM service_requests WHERE table_id = ? AND type = ? AND status = 'open'")
      .get(table.id, type);
    if (existing) {
      return res.status(200).json({ ok: true, deduplicated: true, request_id: existing.id });
    }

    let orderId = null;
    if (req.body.order_code) {
      const order = orders.getOrderByCode(req.body.order_code);
      if (order && order.restaurant_id === restaurant.id) orderId = order.id;
    }

    const info = db
      .prepare(
        `INSERT INTO service_requests (restaurant_id, table_id, order_id, type, note)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(restaurant.id, table.id, orderId, type, str(req.body.note, 'note', { max: 200 }));

    const payload = {
      id: info.lastInsertRowid,
      type,
      table_label: table.label,
      table_id: table.id,
      status: 'open',
      created_at: new Date().toISOString(),
    };
    events.publish(events.restaurantChannel(restaurant.id), 'service_request.created', payload);

    return res.status(201).json({ ok: true, request: payload });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// Paying from the table
// ---------------------------------------------------------------------------

/** Begin (or resume) an online payment for an order. */
router.post('/orders/:code/pay', async (req, res, next) => {
  try {
    const intent = await payments.createIntent(req.params.code);
    res.status(201).json({
      intent,
      publishable_key: intent.provider === 'stripe' ? config.stripePublishableKey : undefined,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Complete a simulated payment. Only the built-in mock provider accepts card
 * details here; with a real provider the browser talks to the provider
 * directly and calls /sync below.
 */
router.post('/payments/:reference/confirm', (req, res, next) => {
  try {
    const result = payments.confirmMock(req.params.reference, req.body.card_number);
    res.json({ status: result.status, order: result.order });
  } catch (err) {
    next(err);
  }
});

/** Ask the server to re-read the provider's authoritative payment status. */
router.post('/payments/:reference/sync', async (req, res, next) => {
  try {
    const result = await payments.syncFromProvider(req.params.reference);
    res.json({ status: result.status, order: result.order });
  } catch (err) {
    next(err);
  }
});

/** One review per order, allowed once the food has arrived. */
router.post('/orders/:code/review', (req, res, next) => {
  try {
    const order = orders.getOrderByCode(req.params.code);
    if (!order) throw notFound('No order matches that code');
    if (!['served', 'completed'].includes(order.status)) {
      throw conflict('You can leave a review once your order has been served');
    }

    const rating = int(req.body.rating, 'rating', { required: true, min: 1, max: 5 });
    const comment = str(req.body.comment, 'comment', { max: 500 });

    const existing = db.prepare('SELECT id FROM reviews WHERE order_id = ?').get(order.id);
    if (existing) throw conflict('You have already reviewed this order');

    db.prepare('INSERT INTO reviews (restaurant_id, order_id, rating, comment) VALUES (?, ?, ?, ?)').run(
      order.restaurant_id,
      order.id,
      rating,
      comment
    );
    events.publish(events.restaurantChannel(order.restaurant_id), 'review.created', {
      order_code: order.code,
      rating,
      comment,
    });
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** Lightweight lead capture from the marketing landing page. */
router.post('/signup-interest', (req, res, next) => {
  try {
    const payload = {
      name: str(req.body.name, 'name', { required: true, max: 120 }),
      email: email(req.body.email),
      restaurant: str(req.body.restaurant, 'restaurant', { max: 120 }),
    };
    db.prepare(
      `INSERT INTO audit_logs (actor_email, action, entity, meta) VALUES (?, 'lead.created', 'lead', ?)`
    ).run(payload.email, JSON.stringify(payload));
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
