'use strict';

const crypto = require('crypto');
const config = require('../config');
const { db } = require('../db');
const events = require('../lib/events');
const { badRequest, conflict, notFound } = require('../lib/errors');
const { money } = require('../lib/validate');

/**
 * Online payments.
 *
 * Two providers share one interface:
 *
 *   mock    — the default. Simulates an authorisation locally so the whole
 *             flow (intent → confirm → receipt) is demonstrable and testable
 *             without network access or an account. It NEVER moves real money
 *             and never sees a real card number.
 *   stripe  — used when STRIPE_SECRET_KEY is set. Creates a real PaymentIntent
 *             over Stripe's REST API with fetch, so no SDK is needed.
 *
 * The order's `payment_status` remains the source of truth for "is it paid";
 * the payments table records each attempt.
 */

const MOCK_CARDS = {
  // Test numbers chosen to make each branch reachable from the UI.
  '4242424242424242': { outcome: 'succeeded' },
  '4000000000000002': { outcome: 'failed', reason: 'Your card was declined.' },
  '4000000000009995': { outcome: 'failed', reason: 'Insufficient funds.' },
};

function activeProvider() {
  return config.stripeSecretKey ? 'stripe' : 'mock';
}

function reference() {
  return `pay_${crypto.randomBytes(16).toString('hex')}`;
}

/** Minor units (cents/fils). Stripe and most processors bill in these. */
function toMinorUnits(amount, currency) {
  // Currencies without a minor unit must not be multiplied by 100.
  const ZERO_DECIMAL = ['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'XOF', 'XAF'];
  const THREE_DECIMAL = ['BHD', 'JOD', 'KWD', 'OMR', 'TND'];
  const code = String(currency || 'USD').toUpperCase();
  if (ZERO_DECIMAL.includes(code)) return Math.round(amount);
  if (THREE_DECIMAL.includes(code)) return Math.round(amount * 1000);
  return Math.round(amount * 100);
}

// ---------------------------------------------------------------------------
// Stripe transport — REST over fetch, no SDK dependency.
// ---------------------------------------------------------------------------
async function stripeRequest(path, form) {
  const body = new URLSearchParams(form).toString();
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload && payload.error ? payload.error.message : `HTTP ${response.status}`;
    throw badRequest(`Payment provider rejected the request: ${detail}`);
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const selectOrder = `
  SELECT o.*, r.currency, r.online_payments_enabled, r.name AS restaurant_name
    FROM orders o JOIN restaurants r ON r.id = o.restaurant_id
   WHERE o.code = ?
`;

function loadPayableOrder(code) {
  const order = db.prepare(selectOrder).get(String(code).toUpperCase());
  if (!order) throw notFound('No order matches that code');
  if (!order.online_payments_enabled) {
    throw conflict('This restaurant does not accept payment from the table right now.');
  }
  if (order.payment_status === 'paid') throw conflict('This order has already been paid.');
  if (order.status === 'cancelled') throw conflict('This order was cancelled and cannot be paid.');
  if (order.total <= 0) throw conflict('This order has nothing to pay.');
  return order;
}

/**
 * Start (or resume) a payment for an order.
 * Reuses an existing unfinished attempt so a page refresh does not create
 * a second charge.
 */
async function createIntent(code) {
  const order = loadPayableOrder(code);

  const existing = db
    .prepare(
      `SELECT * FROM payments
        WHERE order_id = ? AND status IN ('requires_payment','processing')
        ORDER BY id DESC LIMIT 1`
    )
    .get(order.id);
  if (existing) return shapeIntent(existing, order);

  const provider = activeProvider();
  const ref = reference();
  let providerRef = '';
  let clientSecret = null;

  if (provider === 'stripe') {
    const intent = await stripeRequest('/payment_intents', {
      amount: String(toMinorUnits(order.total, order.currency)),
      currency: String(order.currency).toLowerCase(),
      'automatic_payment_methods[enabled]': 'true',
      'metadata[order_code]': order.code,
      'metadata[restaurant_id]': String(order.restaurant_id),
      description: `Order ${order.code} — ${order.restaurant_name}`,
    });
    providerRef = intent.id;
    clientSecret = intent.client_secret;
  }

  const info = db
    .prepare(
      `INSERT INTO payments (restaurant_id, order_id, reference, provider, provider_ref, amount, currency, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'requires_payment')`
    )
    .run(order.restaurant_id, order.id, ref, provider, providerRef, order.total, order.currency);

  db.prepare('UPDATE orders SET payment_reference = ? WHERE id = ?').run(ref, order.id);

  const row = db.prepare('SELECT * FROM payments WHERE id = ?').get(info.lastInsertRowid);
  return { ...shapeIntent(row, order), client_secret: clientSecret };
}

function shapeIntent(payment, order) {
  return {
    reference: payment.reference,
    provider: payment.provider,
    status: payment.status,
    amount: money(payment.amount),
    currency: payment.currency,
    order_code: order.code,
    // Only the mock provider ever accepts card details through this server.
    test_cards: payment.provider === 'mock'
      ? [
          { number: '4242 4242 4242 4242', label: 'Approves' },
          { number: '4000 0000 0000 0002', label: 'Declined' },
          { number: '4000 0000 0000 9995', label: 'Insufficient funds' },
        ]
      : undefined,
  };
}

/**
 * Confirm a mock payment.
 *
 * Only reachable with the mock provider: a real integration confirms on the
 * client with the provider's SDK and is settled here by `syncFromProvider`.
 */
function confirmMock(ref, cardNumber) {
  const payment = db.prepare('SELECT * FROM payments WHERE reference = ?').get(String(ref));
  if (!payment) throw notFound('Unknown payment reference');
  if (payment.provider !== 'mock') {
    throw conflict('This payment must be completed with the payment provider, not here.');
  }
  if (payment.status === 'succeeded') return settle(payment.id, 'succeeded');
  if (!['requires_payment', 'processing'].includes(payment.status)) {
    throw conflict(`This payment is already ${payment.status}.`);
  }

  const digits = String(cardNumber || '').replace(/\D/g, '');
  if (digits.length < 12) throw badRequest('Enter a valid card number.');

  const behaviour = MOCK_CARDS[digits] || { outcome: 'succeeded' };
  if (behaviour.outcome === 'failed') {
    db.prepare(
      "UPDATE payments SET status = 'failed', failure_reason = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(behaviour.reason, payment.id);
    throw badRequest(behaviour.reason);
  }
  return settle(payment.id, 'succeeded');
}

/** Mark a payment settled and flip the order to paid, atomically. */
function settle(paymentId, status) {
  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
  if (!payment) throw notFound('Unknown payment');

  db.transaction(() => {
    db.prepare("UPDATE payments SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, paymentId);

    if (status === 'succeeded') {
      db.prepare(
        `UPDATE orders SET payment_status = 'paid', payment_method = 'online', updated_at = datetime('now')
          WHERE id = ?`
      ).run(payment.order_id);
      db.prepare(
        "INSERT INTO order_events (order_id, status, note) SELECT id, status, 'Paid online by the guest' FROM orders WHERE id = ?"
      ).run(payment.order_id);
    }
  })();

  const order = require('./orders').getOrderById(payment.order_id);
  events.publish(events.restaurantChannel(order.restaurant_id), 'order.updated', order);
  events.publish(events.orderChannel(order.code), 'order.updated', order);
  events.publish(events.restaurantChannel(order.restaurant_id), 'payment.settled', {
    order_code: order.code,
    amount: payment.amount,
    currency: payment.currency,
  });

  return { status, order };
}

/**
 * Re-read a Stripe PaymentIntent and settle the order if it has succeeded.
 * The guest's browser calls this after the provider's SDK reports success;
 * the authoritative status always comes from the provider, never the client.
 */
async function syncFromProvider(ref) {
  const payment = db.prepare('SELECT * FROM payments WHERE reference = ?').get(String(ref));
  if (!payment) throw notFound('Unknown payment reference');
  if (payment.status === 'succeeded') {
    return { status: 'succeeded', order: require('./orders').getOrderById(payment.order_id) };
  }
  if (payment.provider !== 'stripe') throw conflict('This payment is not handled by an external provider.');

  const response = await fetch(`https://api.stripe.com/v1/payment_intents/${payment.provider_ref}`, {
    headers: { Authorization: `Bearer ${config.stripeSecretKey}` },
  });
  const intent = await response.json().catch(() => null);
  if (!response.ok || !intent) throw badRequest('Could not confirm the payment with the provider.');

  if (intent.status === 'succeeded') return settle(payment.id, 'succeeded');

  db.prepare("UPDATE payments SET status = 'processing', updated_at = datetime('now') WHERE id = ?").run(payment.id);
  return { status: intent.status, order: require('./orders').getOrderById(payment.order_id) };
}

/** Staff-side refund. The mock provider records it; Stripe is called for real. */
async function refund(orderId, actor) {
  const payment = db
    .prepare("SELECT * FROM payments WHERE order_id = ? AND status = 'succeeded' ORDER BY id DESC LIMIT 1")
    .get(orderId);
  if (!payment) throw conflict('This order has no settled online payment to refund.');

  if (payment.provider === 'stripe') {
    await stripeRequest('/refunds', { payment_intent: payment.provider_ref });
  }

  db.transaction(() => {
    db.prepare("UPDATE payments SET status = 'refunded', updated_at = datetime('now') WHERE id = ?").run(payment.id);
    db.prepare(
      "UPDATE orders SET payment_status = 'refunded', updated_at = datetime('now') WHERE id = ?"
    ).run(orderId);
    db.prepare('INSERT INTO order_events (order_id, status, note, actor_user_id) SELECT id, status, ?, ? FROM orders WHERE id = ?')
      .run('Online payment refunded', actor ? actor.id : null, orderId);
  })();

  const order = require('./orders').getOrderById(orderId);
  events.publish(events.restaurantChannel(order.restaurant_id), 'order.updated', order);
  events.publish(events.orderChannel(order.code), 'order.updated', order);
  return order;
}

function listForOrder(orderId) {
  return db
    .prepare('SELECT id, reference, provider, status, amount, currency, failure_reason, created_at FROM payments WHERE order_id = ? ORDER BY id DESC')
    .all(orderId);
}

module.exports = {
  activeProvider,
  createIntent,
  confirmMock,
  syncFromProvider,
  refund,
  listForOrder,
  toMinorUnits,
};
