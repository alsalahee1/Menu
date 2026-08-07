'use strict';

const express = require('express');
const QRCode = require('qrcode');
const config = require('../config');
const { db } = require('../db');
const { getMenu } = require('../services/menu');
const orderService = require('../services/orders');
const payments = require('../services/payments');
const events = require('../lib/events');
const audit = require('../lib/audit');
const { hashPassword } = require('../lib/password');
const { str, int, num, bool, oneOf, email, randomCode, money } = require('../lib/validate');
const { notFound, badRequest, forbidden, conflict } = require('../lib/errors');
const {
  requireAuth,
  requireRole,
  requireRestaurantScope,
  RESTAURANT_ADMIN_ROLES,
  RESTAURANT_STAFF_ROLES,
} = require('../middleware/auth');

const router = express.Router();

// Every route below is authenticated and pinned to exactly one tenant.
router.use(requireAuth, requireRole('super_admin', ...RESTAURANT_STAFF_ROLES), requireRestaurantScope);

const canAdmin = requireRole('super_admin', ...RESTAURANT_ADMIN_ROLES);

/** Guard that a row belongs to the caller's restaurant before touching it. */
function ownedOrThrow(table, id, restaurantId, label = 'Record') {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row || row.restaurant_id !== restaurantId) throw notFound(`${label} not found`);
  return row;
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
router.get('/overview', (req, res) => {
  const rid = req.restaurantId;

  const today = db
    .prepare(
      `SELECT COUNT(*) AS orders,
              COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total ELSE 0 END), 0) AS revenue,
              COALESCE(AVG(CASE WHEN status != 'cancelled' THEN total END), 0) AS avg_ticket
         FROM orders
        WHERE restaurant_id = ? AND date(placed_at) = date('now')`
    )
    .get(rid);

  const active = db
    .prepare(
      `SELECT status, COUNT(*) AS n FROM orders
        WHERE restaurant_id = ? AND status IN ('pending','accepted','preparing','ready','served')
        GROUP BY status`
    )
    .all(rid);

  const tables = db
    .prepare('SELECT status, COUNT(*) AS n FROM tables WHERE restaurant_id = ? GROUP BY status')
    .all(rid);

  const openRequests = db
    .prepare("SELECT COUNT(*) AS n FROM service_requests WHERE restaurant_id = ? AND status = 'open'")
    .get(rid).n;

  const topItems = db
    .prepare(
      `SELECT oi.name_snapshot AS name, SUM(oi.qty) AS qty, SUM(oi.line_total) AS revenue
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.restaurant_id = ? AND o.status != 'cancelled'
          AND date(o.placed_at) >= date('now','-7 day')
        GROUP BY oi.name_snapshot ORDER BY qty DESC LIMIT 5`
    )
    .all(rid);

  const last7 = db
    .prepare(
      `SELECT date(placed_at) AS day, COUNT(*) AS orders,
              COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total ELSE 0 END),0) AS revenue
         FROM orders
        WHERE restaurant_id = ? AND date(placed_at) >= date('now','-6 day')
        GROUP BY day ORDER BY day`
    )
    .all(rid);

  const rating = db
    .prepare('SELECT ROUND(AVG(rating),2) AS avg, COUNT(*) AS n FROM reviews WHERE restaurant_id = ?')
    .get(rid);

  const recent = db
    .prepare(
      `SELECT o.id, o.code, o.status, o.total, o.placed_at, o.type, t.label AS table_label
         FROM orders o LEFT JOIN tables t ON t.id = o.table_id
        WHERE o.restaurant_id = ? ORDER BY o.id DESC LIMIT 8`
    )
    .all(rid);

  res.json({
    today: { ...today, revenue: money(today.revenue), avg_ticket: money(today.avg_ticket) },
    active_by_status: Object.fromEntries(active.map((r) => [r.status, r.n])),
    tables_by_status: Object.fromEntries(tables.map((r) => [r.status, r.n])),
    open_requests: openRequests,
    top_items: topItems,
    last_7_days: last7,
    rating,
    recent_orders: recent,
  });
});

/** Live feed powering the orders board and the kitchen display. */
router.get('/stream', (req, res) => {
  events.sseHandler(req, res, [events.restaurantChannel(req.restaurantId)]);
});

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
router.get('/orders', (req, res, next) => {
  try {
    const filters = ['o.restaurant_id = ?'];
    const params = [req.restaurantId];

    if (req.query.status === 'active') {
      filters.push(`o.status IN (${orderService.ACTIVE_STATUSES.map(() => '?').join(',')})`);
      params.push(...orderService.ACTIVE_STATUSES);
    } else if (req.query.status) {
      filters.push('o.status = ?');
      params.push(
        oneOf(req.query.status, 'status', [
          'pending', 'accepted', 'preparing', 'ready', 'served', 'completed', 'cancelled',
        ])
      );
    }
    if (req.query.from) {
      filters.push('date(o.placed_at) >= date(?)');
      params.push(str(req.query.from, 'from', { max: 20 }));
    }
    if (req.query.to) {
      filters.push('date(o.placed_at) <= date(?)');
      params.push(str(req.query.to, 'to', { max: 20 }));
    }
    if (req.query.q) {
      filters.push('(o.code LIKE ? OR o.customer_name LIKE ? OR t.label LIKE ?)');
      const like = `%${str(req.query.q, 'q', { max: 60 })}%`;
      params.push(like, like, like);
    }

    const limit = int(req.query.limit, 'limit', { fallback: 100, min: 1, max: 500 });
    const rows = db
      .prepare(
        `SELECT o.id, o.code, o.status, o.type, o.total, o.subtotal, o.tax, o.service_charge,
                o.payment_status, o.payment_method, o.customer_name, o.note, o.placed_at, o.updated_at,
                t.label AS table_label,
                (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS line_count
           FROM orders o LEFT JOIN tables t ON t.id = o.table_id
          WHERE ${filters.join(' AND ')}
          ORDER BY o.id DESC LIMIT ?`
      )
      .all(...params, limit);

    res.json({ orders: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/orders/:id', (req, res, next) => {
  try {
    const order = orderService.getOrderById(int(req.params.id, 'id', { required: true }));
    if (!order || order.restaurant_id !== req.restaurantId) throw notFound('Order not found');
    res.json({ order, payments: payments.listForOrder(order.id) });
  } catch (err) {
    next(err);
  }
});

router.patch('/orders/:id/status', (req, res, next) => {
  try {
    const id = int(req.params.id, 'id', { required: true });
    ownedOrThrow('orders', id, req.restaurantId, 'Order');

    const status = oneOf(req.body.status, 'status', Object.keys(orderService.NEXT_STATUS), { required: true });
    // Only owners/managers may override the normal forward-only flow.
    const force = bool(req.body.force) && ['super_admin', 'owner', 'manager'].includes(req.user.role);

    const order = orderService.updateStatus(id, status, {
      user: req.user,
      note: str(req.body.note, 'note', { max: 300 }),
      force,
    });
    audit.log(req.user, 'order.status_changed', {
      restaurantId: req.restaurantId, entity: 'order', entityId: id, meta: { status, force },
    });
    res.json({ order });
  } catch (err) {
    next(err);
  }
});

router.patch('/orders/:id/payment', canAdmin, async (req, res, next) => {
  try {
    const id = int(req.params.id, 'id', { required: true });
    ownedOrThrow('orders', id, req.restaurantId, 'Order');

    const nextStatus = oneOf(req.body.payment_status, 'payment_status', ['unpaid', 'paid', 'refunded'], {
      required: true,
    });

    // Refunding an order settled online has to go back through the provider,
    // not just flip a column.
    if (nextStatus === 'refunded') {
      const settled = db
        .prepare("SELECT 1 FROM payments WHERE order_id = ? AND status = 'succeeded'")
        .get(id);
      if (settled) {
        const refunded = await payments.refund(id, req.user);
        audit.log(req.user, 'order.refunded', {
          restaurantId: req.restaurantId, entity: 'order', entityId: id,
        });
        return res.json({ order: refunded });
      }
    }

    const order = orderService.setPayment(id, {
      paymentStatus: nextStatus,
      paymentMethod: oneOf(req.body.payment_method, 'payment_method', ['cash', 'card', 'online'], {
        fallback: null,
      }),
      user: req.user,
    });
    audit.log(req.user, 'order.payment_updated', {
      restaurantId: req.restaurantId, entity: 'order', entityId: id, meta: { status: order.payment_status },
    });
    return res.json({ order });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Menu — categories
// ---------------------------------------------------------------------------
router.get('/menu', (req, res) => {
  res.json(getMenu(req.restaurantId));
});

router.post('/categories', canAdmin, (req, res, next) => {
  try {
    const info = db
      .prepare(
        `INSERT INTO categories (restaurant_id, name, name_ar, description, description_ar,
                                 icon, sort_order, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        req.restaurantId,
        str(req.body.name, 'name', { required: true, max: 80 }),
        str(req.body.name_ar, 'name_ar', { max: 80 }),
        str(req.body.description, 'description', { max: 300 }),
        str(req.body.description_ar, 'description_ar', { max: 300 }),
        str(req.body.icon, 'icon', { max: 8 }),
        int(req.body.sort_order, 'sort_order', { fallback: 0, min: 0, max: 9999 }),
        bool(req.body.is_active, true) ? 1 : 0
      );
    audit.log(req.user, 'category.created', {
      restaurantId: req.restaurantId, entity: 'category', entityId: info.lastInsertRowid,
    });
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (err) {
    next(err);
  }
});

router.patch('/categories/:id', canAdmin, (req, res, next) => {
  try {
    const id = int(req.params.id, 'id', { required: true });
    const current = ownedOrThrow('categories', id, req.restaurantId, 'Category');

    db.prepare(
      `UPDATE categories SET name = ?, name_ar = ?, description = ?, description_ar = ?,
              icon = ?, sort_order = ?, is_active = ? WHERE id = ?`
    ).run(
      str(req.body.name ?? current.name, 'name', { required: true, max: 80 }),
      str(req.body.name_ar ?? current.name_ar, 'name_ar', { max: 80 }),
      str(req.body.description ?? current.description, 'description', { max: 300 }),
      str(req.body.description_ar ?? current.description_ar, 'description_ar', { max: 300 }),
      str(req.body.icon ?? current.icon, 'icon', { max: 8 }),
      int(req.body.sort_order ?? current.sort_order, 'sort_order', { min: 0, max: 9999 }),
      bool(req.body.is_active, !!current.is_active) ? 1 : 0,
      id
    );
    audit.log(req.user, 'category.updated', { restaurantId: req.restaurantId, entity: 'category', entityId: id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/categories/:id', canAdmin, (req, res, next) => {
  try {
    const id = int(req.params.id, 'id', { required: true });
    ownedOrThrow('categories', id, req.restaurantId, 'Category');
    // Items survive; they fall into "Uncategorised" thanks to ON DELETE SET NULL.
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    audit.log(req.user, 'category.deleted', { restaurantId: req.restaurantId, entity: 'category', entityId: id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Menu — items
// ---------------------------------------------------------------------------
function readItemBody(body, restaurantId, current = null) {
  let categoryId = body.category_id === undefined ? current && current.category_id : body.category_id;
  if (categoryId === '' || categoryId === null) categoryId = null;
  if (categoryId !== null && categoryId !== undefined) {
    categoryId = Number(categoryId);
    const cat = db.prepare('SELECT id FROM categories WHERE id = ? AND restaurant_id = ?').get(categoryId, restaurantId);
    if (!cat) throw badRequest('That category does not belong to your restaurant');
  }

  const tags = Array.isArray(body.tags)
    ? body.tags.map((t) => String(t).trim().slice(0, 30)).filter(Boolean).slice(0, 10)
    : current
      ? JSON.parse(current.tags || '[]')
      : [];

  return {
    category_id: categoryId ?? null,
    name: str(body.name ?? (current && current.name), 'name', { required: true, max: 120 }),
    name_ar: str(body.name_ar ?? (current && current.name_ar), 'name_ar', { max: 120 }),
    description: str(body.description ?? (current && current.description), 'description', { max: 600 }),
    description_ar: str(body.description_ar ?? (current && current.description_ar), 'description_ar', { max: 600 }),
    price: num(body.price ?? (current && current.price), 'price', { required: true, min: 0, max: 100000 }),
    image_url: str(body.image_url ?? (current && current.image_url), 'image_url', { max: 500 }),
    is_available: bool(body.is_available, current ? !!current.is_available : true) ? 1 : 0,
    is_featured: bool(body.is_featured, current ? !!current.is_featured : false) ? 1 : 0,
    prep_minutes: int(body.prep_minutes ?? (current && current.prep_minutes) ?? 10, 'prep_minutes', { min: 0, max: 600 }),
    calories: body.calories === '' || body.calories === undefined || body.calories === null
      ? (current ? current.calories : null)
      : int(body.calories, 'calories', { min: 0, max: 10000 }),
    tags: JSON.stringify(tags),
    sort_order: int(body.sort_order ?? (current && current.sort_order) ?? 0, 'sort_order', { min: 0, max: 9999 }),
  };
}

router.post('/items', canAdmin, (req, res, next) => {
  try {
    const data = readItemBody(req.body, req.restaurantId);
    const info = db
      .prepare(
        `INSERT INTO menu_items (restaurant_id, category_id, name, name_ar, description, description_ar,
                                 price, image_url, is_available, is_featured, prep_minutes,
                                 calories, tags, sort_order)
         VALUES (@restaurant_id, @category_id, @name, @name_ar, @description, @description_ar,
                 @price, @image_url, @is_available, @is_featured, @prep_minutes,
                 @calories, @tags, @sort_order)`
      )
      .run({ restaurant_id: req.restaurantId, ...data });
    audit.log(req.user, 'item.created', {
      restaurantId: req.restaurantId, entity: 'menu_item', entityId: info.lastInsertRowid, meta: { name: data.name },
    });
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (err) {
    next(err);
  }
});

router.patch('/items/:id', canAdmin, (req, res, next) => {
  try {
    const id = int(req.params.id, 'id', { required: true });
    const current = ownedOrThrow('menu_items', id, req.restaurantId, 'Menu item');
    const data = readItemBody(req.body, req.restaurantId, current);

    db.prepare(
      `UPDATE menu_items SET category_id=@category_id, name=@name, name_ar=@name_ar,
              description=@description, description_ar=@description_ar, price=@price,
              image_url=@image_url, is_available=@is_available, is_featured=@is_featured,
              prep_minutes=@prep_minutes, calories=@calories, tags=@tags, sort_order=@sort_order,
              updated_at=datetime('now')
        WHERE id=@id`
    ).run({ id, ...data });
    audit.log(req.user, 'item.updated', { restaurantId: req.restaurantId, entity: 'menu_item', entityId: id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** The 86-button: waiters need this without full menu-editing rights. */
router.patch('/items/:id/availability', (req, res, next) => {
  try {
    const id = int(req.params.id, 'id', { required: true });
    ownedOrThrow('menu_items', id, req.restaurantId, 'Menu item');
    const available = bool(req.body.is_available, false);
    db.prepare("UPDATE menu_items SET is_available = ?, updated_at = datetime('now') WHERE id = ?").run(
      available ? 1 : 0,
      id
    );
    events.publish(events.restaurantChannel(req.restaurantId), 'menu.updated', { item_id: id, is_available: available });
    res.json({ ok: true, is_available: available });
  } catch (err) {
    next(err);
  }
});

router.delete('/items/:id', canAdmin, (req, res, next) => {
  try {
    const id = int(req.params.id, 'id', { required: true });
    ownedOrThrow('menu_items', id, req.restaurantId, 'Menu item');
    db.prepare('DELETE FROM menu_items WHERE id = ?').run(id);
    audit.log(req.user, 'item.deleted', { restaurantId: req.restaurantId, entity: 'menu_item', entityId: id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Menu — option groups & options
// ---------------------------------------------------------------------------
function ownedItemOrThrow(itemId, restaurantId) {
  const item = db.prepare('SELECT id FROM menu_items WHERE id = ? AND restaurant_id = ?').get(itemId, restaurantId);
  if (!item) throw notFound('Menu item not found');
  return item;
}

function ownedGroupOrThrow(groupId, restaurantId) {
  const group = db
    .prepare(
      `SELECT g.* FROM option_groups g JOIN menu_items m ON m.id = g.item_id
        WHERE g.id = ? AND m.restaurant_id = ?`
    )
    .get(groupId, restaurantId);
  if (!group) throw notFound('Option group not found');
  return group;
}

router.post('/items/:id/option-groups', canAdmin, (req, res, next) => {
  try {
    const itemId = int(req.params.id, 'id', { required: true });
    ownedItemOrThrow(itemId, req.restaurantId);

    const minSelect = int(req.body.min_select, 'min_select', { fallback: 0, min: 0, max: 20 });
    const maxSelect = int(req.body.max_select, 'max_select', { fallback: 1, min: 1, max: 20 });
    if (minSelect > maxSelect) throw badRequest('"min_select" cannot be greater than "max_select"');

    const info = db
      .prepare('INSERT INTO option_groups (item_id, name, name_ar, min_select, max_select, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
      .run(
        itemId,
        str(req.body.name, 'name', { required: true, max: 80 }),
        str(req.body.name_ar, 'name_ar', { max: 80 }),
        minSelect,
        maxSelect,
        int(req.body.sort_order, 'sort_order', { fallback: 0, min: 0, max: 999 })
      );
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (err) {
    next(err);
  }
});

router.delete('/option-groups/:id', canAdmin, (req, res, next) => {
  try {
    const id = int(req.params.id, 'id', { required: true });
    ownedGroupOrThrow(id, req.restaurantId);
    db.prepare('DELETE FROM option_groups WHERE id = ?').run(id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/option-groups/:id/options', canAdmin, (req, res, next) => {
  try {
    const groupId = int(req.params.id, 'id', { required: true });
    ownedGroupOrThrow(groupId, req.restaurantId);
    const info = db
      .prepare('INSERT INTO options (group_id, name, name_ar, price_delta, is_available, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
      .run(
        groupId,
        str(req.body.name, 'name', { required: true, max: 80 }),
        str(req.body.name_ar, 'name_ar', { max: 80 }),
        num(req.body.price_delta, 'price_delta', { fallback: 0, min: -10000, max: 10000 }),
        bool(req.body.is_available, true) ? 1 : 0,
        int(req.body.sort_order, 'sort_order', { fallback: 0, min: 0, max: 999 })
      );
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (err) {
    next(err);
  }
});

router.delete('/options/:id', canAdmin, (req, res, next) => {
  try {
    const id = int(req.params.id, 'id', { required: true });
    const option = db
      .prepare(
        `SELECT o.id FROM options o
           JOIN option_groups g ON g.id = o.group_id
           JOIN menu_items m ON m.id = g.item_id
          WHERE o.id = ? AND m.restaurant_id = ?`
      )
      .get(id, req.restaurantId);
    if (!option) throw notFound('Option not found');
    db.prepare('DELETE FROM options WHERE id = ?').run(id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Tables & QR codes
// ---------------------------------------------------------------------------
function tableUrl(slug, code) {
  return `${config.publicBaseUrl}/t/${slug}/${code}`;
}

router.get('/tables', (req, res) => {
  const restaurant = db.prepare('SELECT slug FROM restaurants WHERE id = ?').get(req.restaurantId);
  const rows = db
    .prepare(
      `SELECT t.*, (SELECT COUNT(*) FROM orders o
                     WHERE o.table_id = t.id AND o.status NOT IN ('completed','cancelled')) AS active_orders
         FROM tables t WHERE t.restaurant_id = ? ORDER BY t.zone, t.label`
    )
    .all(req.restaurantId);

  res.json({
    tables: rows.map((t) => ({ ...t, url: tableUrl(restaurant.slug, t.code) })),
  });
});

router.post('/tables', canAdmin, (req, res, next) => {
  try {
    const restaurant = db.prepare('SELECT slug FROM restaurants WHERE id = ?').get(req.restaurantId);
    let code = str(req.body.code, 'code', { max: 20 }).toUpperCase();
    if (!code) {
      do {
        code = randomCode(5);
      } while (db.prepare('SELECT 1 FROM tables WHERE restaurant_id = ? AND code = ?').get(req.restaurantId, code));
    }
    if (db.prepare('SELECT 1 FROM tables WHERE restaurant_id = ? AND code = ?').get(req.restaurantId, code)) {
      throw conflict('A table with that code already exists');
    }

    const info = db
      .prepare('INSERT INTO tables (restaurant_id, label, code, seats, zone, status) VALUES (?, ?, ?, ?, ?, ?)')
      .run(
        req.restaurantId,
        str(req.body.label, 'label', { required: true, max: 40 }),
        code,
        int(req.body.seats, 'seats', { fallback: 4, min: 1, max: 40 }),
        str(req.body.zone, 'zone', { max: 40 }) || 'Main',
        oneOf(req.body.status, 'status', ['free', 'occupied', 'reserved', 'inactive'], { fallback: 'free' })
      );
    audit.log(req.user, 'table.created', {
      restaurantId: req.restaurantId, entity: 'table', entityId: info.lastInsertRowid, meta: { code },
    });
    res.status(201).json({ id: info.lastInsertRowid, code, url: tableUrl(restaurant.slug, code) });
  } catch (err) {
    next(err);
  }
});

router.patch('/tables/:id', (req, res, next) => {
  try {
    const id = int(req.params.id, 'id', { required: true });
    const current = ownedOrThrow('tables', id, req.restaurantId, 'Table');

    // Waiters may only flip the seating status; the rest needs admin rights.
    const isAdmin = ['super_admin', 'owner', 'manager'].includes(req.user.role);
    if (!isAdmin && (req.body.label !== undefined || req.body.seats !== undefined || req.body.zone !== undefined)) {
      throw forbidden('Only an owner or manager can rename or resize a table');
    }

    db.prepare('UPDATE tables SET label = ?, seats = ?, zone = ?, status = ? WHERE id = ?').run(
      isAdmin ? str(req.body.label ?? current.label, 'label', { required: true, max: 40 }) : current.label,
      isAdmin ? int(req.body.seats ?? current.seats, 'seats', { min: 1, max: 40 }) : current.seats,
      isAdmin ? str(req.body.zone ?? current.zone, 'zone', { max: 40 }) || 'Main' : current.zone,
      oneOf(req.body.status ?? current.status, 'status', ['free', 'occupied', 'reserved', 'inactive']),
      id
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/tables/:id', canAdmin, (req, res, next) => {
  try {
    const id = int(req.params.id, 'id', { required: true });
    ownedOrThrow('tables', id, req.restaurantId, 'Table');
    const active = db
      .prepare("SELECT COUNT(*) AS n FROM orders WHERE table_id = ? AND status NOT IN ('completed','cancelled')")
      .get(id).n;
    if (active > 0) throw conflict('This table still has active orders — close them first');

    db.prepare('DELETE FROM tables WHERE id = ?').run(id);
    audit.log(req.user, 'table.deleted', { restaurantId: req.restaurantId, entity: 'table', entityId: id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** Rotate a table's code — used when a printed QR leaks or gets abused. */
router.post('/tables/:id/rotate-code', canAdmin, (req, res, next) => {
  try {
    const id = int(req.params.id, 'id', { required: true });
    ownedOrThrow('tables', id, req.restaurantId, 'Table');
    const restaurant = db.prepare('SELECT slug FROM restaurants WHERE id = ?').get(req.restaurantId);

    let code;
    do {
      code = randomCode(5);
    } while (db.prepare('SELECT 1 FROM tables WHERE restaurant_id = ? AND code = ?').get(req.restaurantId, code));

    db.prepare('UPDATE tables SET code = ? WHERE id = ?').run(code, id);
    audit.log(req.user, 'table.code_rotated', { restaurantId: req.restaurantId, entity: 'table', entityId: id });
    res.json({ code, url: tableUrl(restaurant.slug, code) });
  } catch (err) {
    next(err);
  }
});

/** QR image for a table. `format` is svg (default) or png. */
router.get('/tables/:id/qr', async (req, res, next) => {
  try {
    const id = int(req.params.id, 'id', { required: true });
    const table = ownedOrThrow('tables', id, req.restaurantId, 'Table');
    const restaurant = db.prepare('SELECT slug FROM restaurants WHERE id = ?').get(req.restaurantId);
    const url = tableUrl(restaurant.slug, table.code);

    const opts = {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: int(req.query.size, 'size', { fallback: 512, min: 128, max: 2000 }),
      color: { dark: '#111111', light: '#ffffff' },
    };

    if (req.query.format === 'png') {
      const buffer = await QRCode.toBuffer(url, { ...opts, type: 'png' });
      res.type('png').set('Cache-Control', 'no-store').send(buffer);
      return;
    }
    const svg = await QRCode.toString(url, { ...opts, type: 'svg' });
    res.type('svg').set('Cache-Control', 'no-store').send(svg);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Service requests
// ---------------------------------------------------------------------------
router.get('/service-requests', (req, res) => {
  const status = req.query.status === 'all' ? null : 'open';
  const rows = db
    .prepare(
      `SELECT s.*, t.label AS table_label, o.code AS order_code
         FROM service_requests s
         LEFT JOIN tables t ON t.id = s.table_id
         LEFT JOIN orders o ON o.id = s.order_id
        WHERE s.restaurant_id = ? ${status ? 'AND s.status = ?' : ''}
        ORDER BY s.id DESC LIMIT 100`
    )
    .all(...(status ? [req.restaurantId, status] : [req.restaurantId]));
  res.json({ requests: rows });
});

router.patch('/service-requests/:id/resolve', (req, res, next) => {
  try {
    const id = int(req.params.id, 'id', { required: true });
    ownedOrThrow('service_requests', id, req.restaurantId, 'Request');
    db.prepare("UPDATE service_requests SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?").run(id);
    events.publish(events.restaurantChannel(req.restaurantId), 'service_request.resolved', { id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------
const ASSIGNABLE_ROLES = ['owner', 'manager', 'waiter', 'kitchen'];

router.get('/staff', canAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, name, email, phone, role, status, last_login_at, created_at
         FROM users WHERE restaurant_id = ? ORDER BY role, name`
    )
    .all(req.restaurantId);
  res.json({ staff: rows });
});

router.post('/staff', canAdmin, (req, res, next) => {
  try {
    const role = oneOf(req.body.role, 'role', ASSIGNABLE_ROLES, { required: true });
    // Only an owner (or the platform admin) can mint another owner.
    if (role === 'owner' && !['owner', 'super_admin'].includes(req.user.role)) {
      throw forbidden('Only an owner can create another owner');
    }

    const addr = email(req.body.email);
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(addr)) {
      throw conflict('That email address is already registered');
    }

    const info = db
      .prepare(
        `INSERT INTO users (restaurant_id, name, email, phone, password_hash, role, status)
         VALUES (?, ?, ?, ?, ?, ?, 'active')`
      )
      .run(
        req.restaurantId,
        str(req.body.name, 'name', { required: true, max: 120 }),
        addr,
        str(req.body.phone, 'phone', { max: 40 }),
        hashPassword(str(req.body.password, 'password', { required: true, min: 8, max: 200 })),
        role
      );
    audit.log(req.user, 'staff.created', {
      restaurantId: req.restaurantId, entity: 'user', entityId: info.lastInsertRowid, meta: { role, email: addr },
    });
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (err) {
    next(err);
  }
});

router.patch('/staff/:id', canAdmin, (req, res, next) => {
  try {
    const id = int(req.params.id, 'id', { required: true });
    const current = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!current || current.restaurant_id !== req.restaurantId) throw notFound('Staff member not found');

    if (current.role === 'owner' && !['owner', 'super_admin'].includes(req.user.role)) {
      throw forbidden('Only an owner can modify another owner');
    }

    const role = oneOf(req.body.role ?? current.role, 'role', ASSIGNABLE_ROLES);
    const status = oneOf(req.body.status ?? current.status, 'status', ['active', 'disabled']);

    // Never let the last active owner lock the restaurant out of its own account.
    if (current.role === 'owner' && (role !== 'owner' || status !== 'active')) {
      const otherOwners = db
        .prepare("SELECT COUNT(*) AS n FROM users WHERE restaurant_id = ? AND role = 'owner' AND status = 'active' AND id != ?")
        .get(req.restaurantId, id).n;
      if (otherOwners === 0) throw conflict('This is the last active owner — promote someone else first');
    }

    db.prepare('UPDATE users SET name = ?, phone = ?, role = ?, status = ? WHERE id = ?').run(
      str(req.body.name ?? current.name, 'name', { required: true, max: 120 }),
      str(req.body.phone ?? current.phone, 'phone', { max: 40 }),
      role,
      status,
      id
    );

    if (req.body.password) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
        hashPassword(str(req.body.password, 'password', { required: true, min: 8, max: 200 })),
        id
      );
    }
    audit.log(req.user, 'staff.updated', { restaurantId: req.restaurantId, entity: 'user', entityId: id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/staff/:id', canAdmin, (req, res, next) => {
  try {
    const id = int(req.params.id, 'id', { required: true });
    const current = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!current || current.restaurant_id !== req.restaurantId) throw notFound('Staff member not found');
    if (current.id === req.user.id) throw conflict('You cannot delete your own account');

    if (current.role === 'owner') {
      const otherOwners = db
        .prepare("SELECT COUNT(*) AS n FROM users WHERE restaurant_id = ? AND role = 'owner' AND id != ?")
        .get(req.restaurantId, id).n;
      if (otherOwners === 0) throw conflict('You cannot remove the last owner');
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    audit.log(req.user, 'staff.deleted', { restaurantId: req.restaurantId, entity: 'user', entityId: id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
router.get('/reports', canAdmin, (req, res, next) => {
  try {
    // Dates are bound as parameters; an omitted range falls back to 30 days.
    const fromDate = req.query.from ? str(req.query.from, 'from', { max: 20 }) : null;
    const toDate = req.query.to ? str(req.query.to, 'to', { max: 20 }) : null;
    const resolved = db
      .prepare("SELECT date('now','-29 day') AS from_date, date('now') AS to_date")
      .get();

    const where = `o.restaurant_id = ?
      AND date(o.placed_at) >= date(${fromDate ? '?' : "'now','-29 day'"})
      AND date(o.placed_at) <= date(${toDate ? '?' : "'now'"})`;
    const params = [req.restaurantId];
    if (fromDate) params.push(fromDate);
    if (toDate) params.push(toDate);

    const summary = db
      .prepare(
        `SELECT COUNT(*) AS orders,
                COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.total ELSE 0 END),0) AS revenue,
                COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.tax ELSE 0 END),0) AS tax,
                COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.service_charge ELSE 0 END),0) AS service_charge,
                COALESCE(AVG(CASE WHEN o.status != 'cancelled' THEN o.total END),0) AS avg_ticket,
                SUM(CASE WHEN o.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
           FROM orders o WHERE ${where}`
      )
      .get(...params);

    const byDay = db
      .prepare(
        `SELECT date(o.placed_at) AS day, COUNT(*) AS orders,
                COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.total ELSE 0 END),0) AS revenue
           FROM orders o WHERE ${where} GROUP BY day ORDER BY day`
      )
      .all(...params);

    const byHour = db
      .prepare(
        `SELECT CAST(strftime('%H', o.placed_at) AS INTEGER) AS hour, COUNT(*) AS orders
           FROM orders o WHERE ${where} GROUP BY hour ORDER BY hour`
      )
      .all(...params);

    const topItems = db
      .prepare(
        `SELECT oi.name_snapshot AS name, SUM(oi.qty) AS qty, SUM(oi.line_total) AS revenue
           FROM order_items oi JOIN orders o ON o.id = oi.order_id
          WHERE ${where} AND o.status != 'cancelled'
          GROUP BY oi.name_snapshot ORDER BY revenue DESC LIMIT 12`
      )
      .all(...params);

    const byCategory = db
      .prepare(
        `SELECT COALESCE(c.name,'Uncategorised') AS category, SUM(oi.qty) AS qty, SUM(oi.line_total) AS revenue
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id
           LEFT JOIN menu_items m ON m.id = oi.item_id
           LEFT JOIN categories c ON c.id = m.category_id
          WHERE ${where} AND o.status != 'cancelled'
          GROUP BY category ORDER BY revenue DESC`
      )
      .all(...params);

    const byPayment = db
      .prepare(
        `SELECT o.payment_method AS method, o.payment_status AS status, COUNT(*) AS orders, SUM(o.total) AS revenue
           FROM orders o WHERE ${where} AND o.status != 'cancelled'
          GROUP BY method, status`
      )
      .all(...params);

    const busiestTables = db
      .prepare(
        `SELECT COALESCE(t.label,'Takeaway') AS table_label, COUNT(*) AS orders,
                COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.total ELSE 0 END),0) AS revenue
           FROM orders o LEFT JOIN tables t ON t.id = o.table_id
          WHERE ${where} GROUP BY table_label ORDER BY revenue DESC LIMIT 10`
      )
      .all(...params);

    res.json({
      range: { from: fromDate || resolved.from_date, to: toDate || resolved.to_date },
      summary: {
        ...summary,
        revenue: money(summary.revenue),
        tax: money(summary.tax),
        service_charge: money(summary.service_charge),
        avg_ticket: money(summary.avg_ticket),
      },
      by_day: byDay,
      by_hour: byHour,
      top_items: topItems,
      by_category: byCategory,
      by_payment: byPayment,
      busiest_tables: busiestTables,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
router.get('/settings', (req, res) => {
  const row = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(req.restaurantId);
  res.json({
    restaurant: {
      ...row,
      accepts_orders: !!row.accepts_orders,
      auto_accept_orders: !!row.auto_accept_orders,
      online_payments_enabled: !!row.online_payments_enabled,
      payment_provider: payments.activeProvider(),
      menu_url: `${config.publicBaseUrl}/r/${row.slug}`,
    },
  });
});

router.patch('/settings', canAdmin, (req, res, next) => {
  try {
    const current = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(req.restaurantId);

    db.prepare(
      `UPDATE restaurants SET name=@name, name_ar=@name_ar, description=@description,
              description_ar=@description_ar, cuisine=@cuisine, logo_url=@logo_url,
              cover_url=@cover_url, phone=@phone, email=@email, address=@address, currency=@currency,
              tax_rate=@tax_rate, service_charge_rate=@service_charge_rate, primary_color=@primary_color,
              accepts_orders=@accepts_orders, auto_accept_orders=@auto_accept_orders,
              online_payments_enabled=@online_payments_enabled,
              opening_hours=@opening_hours, updated_at=datetime('now')
        WHERE id=@id`
    ).run({
      id: req.restaurantId,
      name: str(req.body.name ?? current.name, 'name', { required: true, max: 120 }),
      name_ar: str(req.body.name_ar ?? current.name_ar, 'name_ar', { max: 120 }),
      description: str(req.body.description ?? current.description, 'description', { max: 800 }),
      description_ar: str(req.body.description_ar ?? current.description_ar, 'description_ar', { max: 800 }),
      cuisine: str(req.body.cuisine ?? current.cuisine, 'cuisine', { max: 80 }),
      logo_url: str(req.body.logo_url ?? current.logo_url, 'logo_url', { max: 500 }),
      cover_url: str(req.body.cover_url ?? current.cover_url, 'cover_url', { max: 500 }),
      phone: str(req.body.phone ?? current.phone, 'phone', { max: 40 }),
      email: str(req.body.email ?? current.email, 'email', { max: 200 }),
      address: str(req.body.address ?? current.address, 'address', { max: 300 }),
      currency: str(req.body.currency ?? current.currency, 'currency', { required: true, max: 8 }).toUpperCase(),
      tax_rate: num(req.body.tax_rate ?? current.tax_rate, 'tax_rate', { min: 0, max: 1 }),
      service_charge_rate: num(req.body.service_charge_rate ?? current.service_charge_rate, 'service_charge_rate', {
        min: 0, max: 1,
      }),
      primary_color: str(req.body.primary_color ?? current.primary_color, 'primary_color', { max: 20 }),
      accepts_orders: bool(req.body.accepts_orders, !!current.accepts_orders) ? 1 : 0,
      auto_accept_orders: bool(req.body.auto_accept_orders, !!current.auto_accept_orders) ? 1 : 0,
      online_payments_enabled: bool(req.body.online_payments_enabled, !!current.online_payments_enabled) ? 1 : 0,
      opening_hours: str(req.body.opening_hours ?? current.opening_hours, 'opening_hours', { max: 400 }),
    });

    audit.log(req.user, 'settings.updated', { restaurantId: req.restaurantId, entity: 'restaurant', entityId: req.restaurantId });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
