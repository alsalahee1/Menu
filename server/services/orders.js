'use strict';

const { db } = require('../db');
const { badRequest, notFound, conflict } = require('../lib/errors');
const { money, randomCode } = require('../lib/validate');
const events = require('../lib/events');

/**
 * Forward transitions a normal service follows. Cancellation is handled
 * separately because staff may cancel from any non-terminal state.
 */
const NEXT_STATUS = {
  pending: ['accepted', 'cancelled'],
  accepted: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['served', 'cancelled'],
  served: ['completed'],
  completed: [],
  cancelled: [],
};

const TERMINAL = ['completed', 'cancelled'];
const ACTIVE_STATUSES = ['pending', 'accepted', 'preparing', 'ready', 'served'];

function generateOrderCode() {
  // Collisions are astronomically unlikely but a unique index still guards us.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = randomCode(6);
    const existing = db.prepare('SELECT 1 FROM orders WHERE code = ?').get(code);
    if (!existing) return code;
  }
  throw new Error('Could not allocate a unique order code');
}

/**
 * Re-price a cart from the database. The client never gets to state a price.
 * Returns the validated lines plus the computed money breakdown.
 */
function priceCart(restaurant, lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw badRequest('Your cart is empty');
  }
  if (lines.length > 60) throw badRequest('An order cannot contain more than 60 different lines');

  const itemStmt = db.prepare(
    'SELECT id, name, price, is_available FROM menu_items WHERE id = ? AND restaurant_id = ?'
  );
  const groupStmt = db.prepare(
    'SELECT id, name, min_select, max_select FROM option_groups WHERE item_id = ? ORDER BY sort_order'
  );
  const optionStmt = db.prepare(
    'SELECT id, group_id, name, price_delta, is_available FROM options WHERE group_id = ?'
  );

  const priced = [];

  for (const line of lines) {
    const itemId = Number(line.item_id);
    const qty = Number(line.qty);

    if (!Number.isInteger(itemId) || itemId <= 0) throw badRequest('Each cart line needs a valid item_id');
    if (!Number.isInteger(qty) || qty < 1 || qty > 50) {
      throw badRequest('Quantity must be a whole number between 1 and 50');
    }

    const item = itemStmt.get(itemId, restaurant.id);
    if (!item) throw badRequest(`Menu item ${itemId} is not on this restaurant's menu`);
    if (!item.is_available) throw conflict(`"${item.name}" has just sold out — please remove it from your cart`);

    const selectedIds = Array.isArray(line.option_ids) ? line.option_ids.map(Number) : [];
    const groups = groupStmt.all(itemId);
    const chosen = [];

    for (const group of groups) {
      const groupOptions = optionStmt.all(group.id);
      const picked = groupOptions.filter((opt) => selectedIds.includes(opt.id));

      if (picked.length < group.min_select) {
        throw badRequest(`"${item.name}": choose at least ${group.min_select} from "${group.name}"`);
      }
      if (picked.length > group.max_select) {
        throw badRequest(`"${item.name}": choose at most ${group.max_select} from "${group.name}"`);
      }
      for (const opt of picked) {
        if (!opt.is_available) throw conflict(`"${opt.name}" is currently unavailable`);
        chosen.push({ group: group.name, name: opt.name, price_delta: opt.price_delta });
      }
    }

    // Any id that did not match a group of this item is rejected outright.
    const validIds = new Set(groups.flatMap((g) => optionStmt.all(g.id)).map((o) => o.id));
    for (const id of selectedIds) {
      if (!validIds.has(id)) throw badRequest(`Option ${id} does not belong to "${item.name}"`);
    }

    const unitPrice = money(item.price + chosen.reduce((sum, o) => sum + o.price_delta, 0));
    priced.push({
      item_id: item.id,
      name_snapshot: item.name,
      unit_price: unitPrice,
      qty,
      options_snapshot: JSON.stringify(chosen),
      note: String(line.note || '').slice(0, 300),
      line_total: money(unitPrice * qty),
    });
  }

  const subtotal = money(priced.reduce((sum, l) => sum + l.line_total, 0));
  const serviceCharge = money(subtotal * restaurant.service_charge_rate);
  const tax = money((subtotal + serviceCharge) * restaurant.tax_rate);
  const total = money(subtotal + serviceCharge + tax);

  return { lines: priced, subtotal, serviceCharge, tax, total };
}

const insertOrder = db.prepare(`
  INSERT INTO orders (restaurant_id, table_id, code, status, type, customer_name, customer_phone,
                      note, subtotal, tax, service_charge, discount, total, session_id)
  VALUES (@restaurant_id, @table_id, @code, @status, @type, @customer_name, @customer_phone,
          @note, @subtotal, @tax, @service_charge, 0, @total, @session_id)
`);

const insertOrderItem = db.prepare(`
  INSERT INTO order_items (order_id, item_id, name_snapshot, unit_price, qty, options_snapshot, note, line_total)
  VALUES (@order_id, @item_id, @name_snapshot, @unit_price, @qty, @options_snapshot, @note, @line_total)
`);

const insertEvent = db.prepare(`
  INSERT INTO order_events (order_id, status, note, actor_user_id) VALUES (?, ?, ?, ?)
`);

/** Create an order atomically, then broadcast it to the kitchen. */
function createOrder(restaurant, payload) {
  if (restaurant.status !== 'active') throw conflict('This restaurant is not currently accepting orders');
  if (!restaurant.accepts_orders) throw conflict('The restaurant has paused online ordering right now');

  const { lines, subtotal, serviceCharge, tax, total } = priceCart(restaurant, payload.items);
  const status = restaurant.auto_accept_orders ? 'accepted' : 'pending';

  const run = db.transaction(() => {
    const code = generateOrderCode();
    const info = insertOrder.run({
      restaurant_id: restaurant.id,
      table_id: payload.table_id ?? null,
      code,
      status,
      type: payload.type || 'dine_in',
      customer_name: payload.customer_name || '',
      customer_phone: payload.customer_phone || '',
      note: payload.note || '',
      subtotal,
      tax,
      service_charge: serviceCharge,
      total,
      session_id: payload.session_id || '',
    });

    const orderId = info.lastInsertRowid;
    for (const line of lines) insertOrderItem.run({ order_id: orderId, ...line });
    insertEvent.run(orderId, status, 'Order placed by guest', null);

    if (payload.table_id) {
      db.prepare("UPDATE tables SET status = 'occupied' WHERE id = ? AND status = 'free'").run(payload.table_id);
    }
    return orderId;
  });

  const orderId = run();
  const order = getOrderById(orderId);

  events.publish(events.restaurantChannel(restaurant.id), 'order.created', order);
  events.publish(events.orderChannel(order.code), 'order.updated', order);
  return order;
}

function shapeOrder(row) {
  if (!row) return null;

  const items = db
    .prepare(
      `SELECT id, item_id, name_snapshot, unit_price, qty, options_snapshot, note, line_total
         FROM order_items WHERE order_id = ? ORDER BY id`
    )
    .all(row.id)
    .map((line) => {
      let options = [];
      try {
        options = JSON.parse(line.options_snapshot || '[]');
      } catch {
        options = [];
      }
      return { ...line, options_snapshot: undefined, options };
    });

  const timeline = db
    .prepare(
      `SELECT e.id, e.status, e.note, e.created_at, u.name AS actor_name
         FROM order_events e LEFT JOIN users u ON u.id = e.actor_user_id
        WHERE e.order_id = ? ORDER BY e.id ASC`
    )
    .all(row.id);

  return { ...row, online_payments_enabled: !!row.online_payments_enabled, items, timeline };
}

const ORDER_SELECT = `
  SELECT o.*, t.label AS table_label, t.code AS table_code, r.name AS restaurant_name,
         r.name_ar AS restaurant_name_ar, r.slug AS restaurant_slug, r.currency AS currency,
         r.online_payments_enabled AS online_payments_enabled
    FROM orders o
    LEFT JOIN tables t ON t.id = o.table_id
    JOIN restaurants r ON r.id = o.restaurant_id
`;

function getOrderById(id) {
  return shapeOrder(db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(id));
}

function getOrderByCode(code) {
  return shapeOrder(db.prepare(`${ORDER_SELECT} WHERE o.code = ?`).get(String(code).toUpperCase()));
}

/**
 * Move an order to a new status.
 * `force` lets an owner/manager correct a mistake by jumping backwards.
 */
function updateStatus(orderId, nextStatus, { user = null, note = '', force = false } = {}) {
  const current = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!current) throw notFound('Order not found');

  if (current.status === nextStatus) return getOrderById(orderId);

  if (TERMINAL.includes(current.status) && !force) {
    throw conflict(`Order ${current.code} is already ${current.status}`);
  }
  if (!force && !NEXT_STATUS[current.status].includes(nextStatus)) {
    throw conflict(
      `Cannot move an order from "${current.status}" to "${nextStatus}". Allowed: ${
        NEXT_STATUS[current.status].join(', ') || 'none'
      }`
    );
  }

  db.transaction(() => {
    db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(nextStatus, orderId);
    insertEvent.run(orderId, nextStatus, note, user ? user.id : null);

    // Free the table once nothing active is left on it.
    if (TERMINAL.includes(nextStatus) && current.table_id) {
      const stillBusy = db
        .prepare(
          `SELECT COUNT(*) AS n FROM orders
            WHERE table_id = ? AND status NOT IN ('completed','cancelled')`
        )
        .get(current.table_id).n;
      if (stillBusy === 0) {
        db.prepare("UPDATE tables SET status = 'free' WHERE id = ? AND status = 'occupied'").run(current.table_id);
      }
    }
  })();

  const order = getOrderById(orderId);
  events.publish(events.restaurantChannel(order.restaurant_id), 'order.updated', order);
  events.publish(events.orderChannel(order.code), 'order.updated', order);
  return order;
}

function setPayment(orderId, { paymentStatus, paymentMethod, user }) {
  const current = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!current) throw notFound('Order not found');

  db.prepare(
    "UPDATE orders SET payment_status = ?, payment_method = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(paymentStatus, paymentMethod || current.payment_method, orderId);

  insertEvent.run(
    orderId,
    current.status,
    `Payment marked ${paymentStatus} (${paymentMethod || current.payment_method})`,
    user ? user.id : null
  );

  const order = getOrderById(orderId);
  events.publish(events.restaurantChannel(order.restaurant_id), 'order.updated', order);
  events.publish(events.orderChannel(order.code), 'order.updated', order);
  return order;
}

module.exports = {
  NEXT_STATUS,
  TERMINAL,
  ACTIVE_STATUSES,
  priceCart,
  createOrder,
  getOrderById,
  getOrderByCode,
  updateStatus,
  setPayment,
};
