'use strict';

const express = require('express');
const config = require('../config');
const { db } = require('../db');
const audit = require('../lib/audit');
const { hashPassword } = require('../lib/password');
const { str, int, num, bool, oneOf, email, slugify, randomCode, money } = require('../lib/validate');
const { notFound, badRequest, conflict } = require('../lib/errors');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// The whole platform console is super_admin only.
router.use(requireAuth, requireRole('super_admin'));

// ---------------------------------------------------------------------------
// Platform dashboard
// ---------------------------------------------------------------------------
router.get('/stats', (_req, res) => {
  const restaurants = db
    .prepare('SELECT status, COUNT(*) AS n FROM restaurants GROUP BY status')
    .all();
  const plans = db.prepare('SELECT plan, COUNT(*) AS n FROM restaurants GROUP BY plan').all();
  const users = db.prepare('SELECT role, COUNT(*) AS n FROM users GROUP BY role').all();

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS orders,
              COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total ELSE 0 END),0) AS gmv
         FROM orders`
    )
    .get();

  const today = db
    .prepare(
      `SELECT COUNT(*) AS orders,
              COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total ELSE 0 END),0) AS gmv
         FROM orders WHERE date(placed_at) = date('now')`
    )
    .get();

  const last14 = db
    .prepare(
      `SELECT date(placed_at) AS day, COUNT(*) AS orders,
              COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total ELSE 0 END),0) AS gmv
         FROM orders WHERE date(placed_at) >= date('now','-13 day')
        GROUP BY day ORDER BY day`
    )
    .all();

  const leaderboard = db
    .prepare(
      `SELECT r.id, r.name, r.slug, r.plan, r.status,
              COUNT(o.id) AS orders,
              COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.total ELSE 0 END),0) AS revenue
         FROM restaurants r LEFT JOIN orders o ON o.restaurant_id = r.id
        GROUP BY r.id ORDER BY revenue DESC LIMIT 10`
    )
    .all();

  const leads = db
    .prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'lead.created'")
    .get().n;

  res.json({
    restaurants_by_status: Object.fromEntries(restaurants.map((r) => [r.status, r.n])),
    restaurants_by_plan: Object.fromEntries(plans.map((r) => [r.plan, r.n])),
    users_by_role: Object.fromEntries(users.map((r) => [r.role, r.n])),
    totals: { orders: totals.orders, gmv: money(totals.gmv) },
    today: { orders: today.orders, gmv: money(today.gmv) },
    last_14_days: last14,
    leaderboard,
    leads,
  });
});

// ---------------------------------------------------------------------------
// Restaurants (tenants)
// ---------------------------------------------------------------------------
router.get('/restaurants', (req, res, next) => {
  try {
    const filters = [];
    const params = [];
    if (req.query.status) {
      filters.push('r.status = ?');
      params.push(oneOf(req.query.status, 'status', ['active', 'suspended', 'pending']));
    }
    if (req.query.q) {
      filters.push('(r.name LIKE ? OR r.slug LIKE ? OR r.email LIKE ?)');
      const like = `%${str(req.query.q, 'q', { max: 60 })}%`;
      params.push(like, like, like);
    }

    const rows = db
      .prepare(
        `SELECT r.*,
                (SELECT COUNT(*) FROM users u WHERE u.restaurant_id = r.id) AS staff_count,
                (SELECT COUNT(*) FROM tables t WHERE t.restaurant_id = r.id) AS table_count,
                (SELECT COUNT(*) FROM menu_items m WHERE m.restaurant_id = r.id) AS item_count,
                (SELECT COUNT(*) FROM orders o WHERE o.restaurant_id = r.id) AS order_count,
                (SELECT COALESCE(SUM(o.total),0) FROM orders o
                  WHERE o.restaurant_id = r.id AND o.status != 'cancelled') AS revenue
           FROM restaurants r
          ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
          ORDER BY r.created_at DESC`
      )
      .all(...params);

    res.json({
      restaurants: rows.map((r) => ({
        ...r,
        accepts_orders: !!r.accepts_orders,
        revenue: money(r.revenue),
        menu_url: `${config.publicBaseUrl}/r/${r.slug}`,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/restaurants/:id', (req, res, next) => {
  try {
    const id = int(req.params.id, 'id', { required: true });
    const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(id);
    if (!restaurant) throw notFound('Restaurant not found');

    const staff = db
      .prepare('SELECT id, name, email, role, status, last_login_at FROM users WHERE restaurant_id = ? ORDER BY role')
      .all(id);
    const stats = db
      .prepare(
        `SELECT COUNT(*) AS orders,
                COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total ELSE 0 END),0) AS revenue
           FROM orders WHERE restaurant_id = ?`
      )
      .get(id);

    res.json({ restaurant, staff, stats: { ...stats, revenue: money(stats.revenue) } });
  } catch (err) {
    next(err);
  }
});

/** Onboard a tenant: creates the restaurant and its first owner account together. */
router.post('/restaurants', (req, res, next) => {
  try {
    const name = str(req.body.name, 'name', { required: true, max: 120 });
    let slug = slugify(str(req.body.slug, 'slug', { max: 60 }) || name);
    if (!slug) slug = `r-${randomCode(5).toLowerCase()}`;
    if (db.prepare('SELECT 1 FROM restaurants WHERE slug = ?').get(slug)) {
      throw conflict(`The address "/r/${slug}" is already taken`);
    }

    const ownerEmail = email(req.body.owner_email);
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(ownerEmail)) {
      throw conflict('That owner email address is already registered');
    }
    const ownerName = str(req.body.owner_name, 'owner_name', { required: true, max: 120 });
    const ownerPassword = str(req.body.owner_password, 'owner_password', { required: true, min: 8, max: 200 });

    const create = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO restaurants (name, slug, description, cuisine, phone, email, address, currency,
                                    tax_rate, service_charge_rate, primary_color, status, plan)
           VALUES (@name, @slug, @description, @cuisine, @phone, @email, @address, @currency,
                   @tax_rate, @service_charge_rate, @primary_color, @status, @plan)`
        )
        .run({
          name,
          slug,
          description: str(req.body.description, 'description', { max: 800 }),
          cuisine: str(req.body.cuisine, 'cuisine', { max: 80 }),
          phone: str(req.body.phone, 'phone', { max: 40 }),
          email: str(req.body.email, 'email', { max: 200 }),
          address: str(req.body.address, 'address', { max: 300 }),
          currency: (str(req.body.currency, 'currency', { max: 8 }) || 'USD').toUpperCase(),
          tax_rate: num(req.body.tax_rate, 'tax_rate', { fallback: 0, min: 0, max: 1 }),
          service_charge_rate: num(req.body.service_charge_rate, 'service_charge_rate', { fallback: 0, min: 0, max: 1 }),
          primary_color: str(req.body.primary_color, 'primary_color', { max: 20 }) || '#e2603f',
          status: oneOf(req.body.status, 'status', ['active', 'suspended', 'pending'], { fallback: 'active' }),
          plan: oneOf(req.body.plan, 'plan', ['free', 'pro', 'enterprise'], { fallback: 'free' }),
        });

      const restaurantId = info.lastInsertRowid;
      db.prepare(
        `INSERT INTO users (restaurant_id, name, email, password_hash, role, status)
         VALUES (?, ?, ?, ?, 'owner', 'active')`
      ).run(restaurantId, ownerName, ownerEmail, hashPassword(ownerPassword));

      // Give every new tenant a starter floor plan so QR codes work immediately.
      const tableCount = int(req.body.table_count, 'table_count', { fallback: 6, min: 0, max: 60 });
      const insertTable = db.prepare(
        'INSERT INTO tables (restaurant_id, label, code, seats, zone) VALUES (?, ?, ?, ?, ?)'
      );
      for (let i = 1; i <= tableCount; i += 1) {
        let code;
        do {
          code = randomCode(5);
        } while (db.prepare('SELECT 1 FROM tables WHERE restaurant_id = ? AND code = ?').get(restaurantId, code));
        insertTable.run(restaurantId, `Table ${i}`, code, 4, 'Main');
      }
      return restaurantId;
    });

    const id = create();
    audit.log(req.user, 'restaurant.created', { restaurantId: id, entity: 'restaurant', entityId: id, meta: { slug } });
    res.status(201).json({ id, slug });
  } catch (err) {
    next(err);
  }
});

router.patch('/restaurants/:id', (req, res, next) => {
  try {
    const id = int(req.params.id, 'id', { required: true });
    const current = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(id);
    if (!current) throw notFound('Restaurant not found');

    let slug = current.slug;
    if (req.body.slug !== undefined && slugify(req.body.slug) !== current.slug) {
      slug = slugify(req.body.slug);
      if (!slug) throw badRequest('"slug" must contain at least one letter or number');
      if (db.prepare('SELECT 1 FROM restaurants WHERE slug = ? AND id != ?').get(slug, id)) {
        throw conflict(`The address "/r/${slug}" is already taken`);
      }
    }

    db.prepare(
      `UPDATE restaurants SET name=@name, slug=@slug, description=@description, cuisine=@cuisine,
              phone=@phone, email=@email, address=@address, currency=@currency, tax_rate=@tax_rate,
              service_charge_rate=@service_charge_rate, status=@status, plan=@plan,
              accepts_orders=@accepts_orders, updated_at=datetime('now')
        WHERE id=@id`
    ).run({
      id,
      slug,
      name: str(req.body.name ?? current.name, 'name', { required: true, max: 120 }),
      description: str(req.body.description ?? current.description, 'description', { max: 800 }),
      cuisine: str(req.body.cuisine ?? current.cuisine, 'cuisine', { max: 80 }),
      phone: str(req.body.phone ?? current.phone, 'phone', { max: 40 }),
      email: str(req.body.email ?? current.email, 'email', { max: 200 }),
      address: str(req.body.address ?? current.address, 'address', { max: 300 }),
      currency: str(req.body.currency ?? current.currency, 'currency', { required: true, max: 8 }).toUpperCase(),
      tax_rate: num(req.body.tax_rate ?? current.tax_rate, 'tax_rate', { min: 0, max: 1 }),
      service_charge_rate: num(req.body.service_charge_rate ?? current.service_charge_rate, 'service_charge_rate', {
        min: 0, max: 1,
      }),
      status: oneOf(req.body.status ?? current.status, 'status', ['active', 'suspended', 'pending']),
      plan: oneOf(req.body.plan ?? current.plan, 'plan', ['free', 'pro', 'enterprise']),
      accepts_orders: bool(req.body.accepts_orders, !!current.accepts_orders) ? 1 : 0,
    });

    audit.log(req.user, 'restaurant.updated', { restaurantId: id, entity: 'restaurant', entityId: id });
    res.json({ ok: true, slug });
  } catch (err) {
    next(err);
  }
});

/** Deleting a tenant cascades to its menu, tables, staff and order history. */
router.delete('/restaurants/:id', (req, res, next) => {
  try {
    const id = int(req.params.id, 'id', { required: true });
    const current = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(id);
    if (!current) throw notFound('Restaurant not found');
    if (str(req.body.confirm_slug, 'confirm_slug') !== current.slug) {
      throw badRequest(`To delete this restaurant, send confirm_slug = "${current.slug}"`);
    }

    db.prepare('DELETE FROM restaurants WHERE id = ?').run(id);
    audit.log(req.user, 'restaurant.deleted', { entity: 'restaurant', entityId: id, meta: { slug: current.slug } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Users across the platform
// ---------------------------------------------------------------------------
router.get('/users', (req, res, next) => {
  try {
    const filters = [];
    const params = [];
    if (req.query.role) {
      filters.push('u.role = ?');
      params.push(oneOf(req.query.role, 'role', ['super_admin', 'owner', 'manager', 'waiter', 'kitchen']));
    }
    if (req.query.restaurant_id) {
      filters.push('u.restaurant_id = ?');
      params.push(int(req.query.restaurant_id, 'restaurant_id'));
    }
    if (req.query.q) {
      filters.push('(u.name LIKE ? OR u.email LIKE ?)');
      const like = `%${str(req.query.q, 'q', { max: 60 })}%`;
      params.push(like, like);
    }

    const rows = db
      .prepare(
        `SELECT u.id, u.name, u.email, u.phone, u.role, u.status, u.last_login_at, u.created_at,
                r.name AS restaurant_name, r.id AS restaurant_id
           FROM users u LEFT JOIN restaurants r ON r.id = u.restaurant_id
          ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
          ORDER BY u.created_at DESC LIMIT 300`
      )
      .all(...params);
    res.json({ users: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/users', (req, res, next) => {
  try {
    const role = oneOf(req.body.role, 'role', ['super_admin', 'owner', 'manager', 'waiter', 'kitchen'], {
      required: true,
    });
    const addr = email(req.body.email);
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(addr)) {
      throw conflict('That email address is already registered');
    }

    let restaurantId = null;
    if (role !== 'super_admin') {
      restaurantId = int(req.body.restaurant_id, 'restaurant_id', { required: true });
      if (!db.prepare('SELECT 1 FROM restaurants WHERE id = ?').get(restaurantId)) {
        throw badRequest('Unknown restaurant_id');
      }
    }

    const info = db
      .prepare(
        `INSERT INTO users (restaurant_id, name, email, phone, password_hash, role, status)
         VALUES (?, ?, ?, ?, ?, ?, 'active')`
      )
      .run(
        restaurantId,
        str(req.body.name, 'name', { required: true, max: 120 }),
        addr,
        str(req.body.phone, 'phone', { max: 40 }),
        hashPassword(str(req.body.password, 'password', { required: true, min: 8, max: 200 })),
        role
      );
    audit.log(req.user, 'user.created', {
      restaurantId, entity: 'user', entityId: info.lastInsertRowid, meta: { role, email: addr },
    });
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (err) {
    next(err);
  }
});

router.patch('/users/:id', (req, res, next) => {
  try {
    const id = int(req.params.id, 'id', { required: true });
    const current = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!current) throw notFound('User not found');

    const status = oneOf(req.body.status ?? current.status, 'status', ['active', 'disabled']);
    // Guard against the platform locking itself out.
    if (current.role === 'super_admin' && status !== 'active') {
      const others = db
        .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'super_admin' AND status = 'active' AND id != ?")
        .get(id).n;
      if (others === 0) throw conflict('This is the last active platform administrator');
    }

    db.prepare('UPDATE users SET name = ?, phone = ?, role = ?, status = ? WHERE id = ?').run(
      str(req.body.name ?? current.name, 'name', { required: true, max: 120 }),
      str(req.body.phone ?? current.phone, 'phone', { max: 40 }),
      oneOf(req.body.role ?? current.role, 'role', ['super_admin', 'owner', 'manager', 'waiter', 'kitchen']),
      status,
      id
    );
    if (req.body.password) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
        hashPassword(str(req.body.password, 'password', { required: true, min: 8, max: 200 })),
        id
      );
    }
    audit.log(req.user, 'user.updated', { restaurantId: current.restaurant_id, entity: 'user', entityId: id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/users/:id', (req, res, next) => {
  try {
    const id = int(req.params.id, 'id', { required: true });
    const current = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!current) throw notFound('User not found');
    if (current.id === req.user.id) throw conflict('You cannot delete your own account');

    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    audit.log(req.user, 'user.deleted', { entity: 'user', entityId: id, meta: { email: current.email } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Cross-tenant order feed
// ---------------------------------------------------------------------------
router.get('/orders', (req, res, next) => {
  try {
    const filters = [];
    const params = [];
    if (req.query.restaurant_id) {
      filters.push('o.restaurant_id = ?');
      params.push(int(req.query.restaurant_id, 'restaurant_id'));
    }
    if (req.query.status) {
      filters.push('o.status = ?');
      params.push(
        oneOf(req.query.status, 'status', [
          'pending', 'accepted', 'preparing', 'ready', 'served', 'completed', 'cancelled',
        ])
      );
    }
    if (req.query.q) {
      filters.push('o.code LIKE ?');
      params.push(`%${str(req.query.q, 'q', { max: 40 }).toUpperCase()}%`);
    }

    const rows = db
      .prepare(
        `SELECT o.id, o.code, o.status, o.type, o.total, o.payment_status, o.placed_at,
                r.name AS restaurant_name, r.currency, t.label AS table_label
           FROM orders o
           JOIN restaurants r ON r.id = o.restaurant_id
           LEFT JOIN tables t ON t.id = o.table_id
          ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
          ORDER BY o.id DESC LIMIT ?`
      )
      .all(...params, int(req.query.limit, 'limit', { fallback: 100, min: 1, max: 500 }));
    res.json({ orders: rows });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------
router.get('/audit', (req, res, next) => {
  try {
    const filters = [];
    const params = [];
    if (req.query.action) {
      filters.push('a.action LIKE ?');
      params.push(`%${str(req.query.action, 'action', { max: 60 })}%`);
    }
    if (req.query.restaurant_id) {
      filters.push('a.restaurant_id = ?');
      params.push(int(req.query.restaurant_id, 'restaurant_id'));
    }

    const rows = db
      .prepare(
        `SELECT a.*, r.name AS restaurant_name
           FROM audit_logs a LEFT JOIN restaurants r ON r.id = a.restaurant_id
          ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
          ORDER BY a.id DESC LIMIT ?`
      )
      .all(...params, int(req.query.limit, 'limit', { fallback: 150, min: 1, max: 500 }));
    res.json({ logs: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
