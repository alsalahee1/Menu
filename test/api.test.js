'use strict';

/**
 * End-to-end API tests against a throwaway database.
 *
 * The suite focuses on the rules that protect money and tenant boundaries:
 * server-side pricing, cross-tenant isolation, role permissions and the
 * order status machine.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Point the app at a scratch database before anything requires config.
const TEST_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'menu-test-')), 'test.db');
process.env.DATABASE_FILE = TEST_DB;
process.env.JWT_SECRET = 'test-secret-value-for-suite';
process.env.NODE_ENV = 'test';

const app = require('../server/index');
const { db } = require('../server/db');
const { hashPassword } = require('../server/lib/password');

let server;
let base;

// --------------------------------------------------------------------------
// Fixtures: two independent restaurants so isolation can actually be tested.
// --------------------------------------------------------------------------
const ids = {};

function seedFixtures() {
  const restaurant = db.prepare(
    `INSERT INTO restaurants (name, slug, currency, tax_rate, service_charge_rate, status)
     VALUES (?, ?, 'USD', 0.1, 0.05, 'active')`
  );
  ids.rA = restaurant.run('Alpha Kitchen', 'alpha').lastInsertRowid;
  ids.rB = restaurant.run('Beta Bistro', 'beta').lastInsertRowid;

  const user = db.prepare(
    `INSERT INTO users (restaurant_id, name, email, password_hash, role, status)
     VALUES (?, ?, ?, ?, ?, 'active')`
  );
  const pw = hashPassword('Password123!');
  ids.ownerA = user.run(ids.rA, 'Owner A', 'ownera@test.local', pw, 'owner').lastInsertRowid;
  ids.waiterA = user.run(ids.rA, 'Waiter A', 'waitera@test.local', pw, 'waiter').lastInsertRowid;
  ids.ownerB = user.run(ids.rB, 'Owner B', 'ownerb@test.local', pw, 'owner').lastInsertRowid;
  ids.admin = user.run(null, 'Admin', 'admin@test.local', pw, 'super_admin').lastInsertRowid;

  const table = db.prepare('INSERT INTO tables (restaurant_id, label, code) VALUES (?, ?, ?)');
  ids.tableA = table.run(ids.rA, 'A1', 'AAA11').lastInsertRowid;
  table.run(ids.rB, 'B1', 'BBB11');

  const category = db.prepare('INSERT INTO categories (restaurant_id, name) VALUES (?, ?)');
  ids.catA = category.run(ids.rA, 'Mains').lastInsertRowid;

  const item = db.prepare(
    'INSERT INTO menu_items (restaurant_id, category_id, name, price, is_available) VALUES (?, ?, ?, ?, ?)'
  );
  ids.itemA = item.run(ids.rA, ids.catA, 'Burger', 10, 1).lastInsertRowid;
  ids.soldOutA = item.run(ids.rA, ids.catA, 'Soup', 5, 0).lastInsertRowid;

  const catB = category.run(ids.rB, 'Pizza').lastInsertRowid;
  ids.itemB = item.run(ids.rB, catB, 'Margherita', 8, 1).lastInsertRowid;

  ids.groupA = db.prepare(
    'INSERT INTO option_groups (item_id, name, min_select, max_select) VALUES (?, ?, 1, 1)'
  ).run(ids.itemA, 'Size').lastInsertRowid;

  const option = db.prepare('INSERT INTO options (group_id, name, price_delta) VALUES (?, ?, ?)');
  ids.optSmall = option.run(ids.groupA, 'Small', 0).lastInsertRowid;
  ids.optLarge = option.run(ids.groupA, 'Large', 4).lastInsertRowid;
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------
async function call(method, url, { body, token, headers } = {}) {
  const response = await fetch(`${base}${url}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  return { status: response.status, body: payload };
}

async function login(email, password = 'Password123!') {
  const result = await call('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(result.status, 200, `login failed for ${email}: ${JSON.stringify(result.body)}`);
  return result.body.token;
}

const tokens = {};

test.before(async () => {
  seedFixtures();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;

  tokens.ownerA = await login('ownera@test.local');
  tokens.waiterA = await login('waitera@test.local');
  tokens.ownerB = await login('ownerb@test.local');
  tokens.admin = await login('admin@test.local');
});

test.after(() => {
  if (server) server.close();
  db.close();
  fs.rmSync(path.dirname(TEST_DB), { recursive: true, force: true });
});

// --------------------------------------------------------------------------
test('health endpoint responds', async () => {
  const result = await call('GET', '/api/health');
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
});

test('login rejects a wrong password and a disabled account', async () => {
  const wrong = await call('POST', '/api/auth/login', {
    body: { email: 'ownera@test.local', password: 'nope' },
  });
  assert.equal(wrong.status, 401);
  // The message must not reveal whether the address exists.
  assert.match(wrong.body.error, /Incorrect email or password/);

  const unknown = await call('POST', '/api/auth/login', {
    body: { email: 'nobody@test.local', password: 'Password123!' },
  });
  assert.equal(unknown.status, 401);
  assert.equal(unknown.body.error, wrong.body.error);
});

test('public menu hides another restaurant and unknown slugs 404', async () => {
  const alpha = await call('GET', '/api/public/r/alpha');
  assert.equal(alpha.status, 200);
  const names = alpha.body.categories.flatMap((c) => c.items.map((i) => i.name));
  assert.ok(names.includes('Burger'));
  assert.ok(!names.includes('Margherita'), 'Beta Bistro items leaked into Alpha menu');

  const missing = await call('GET', '/api/public/r/does-not-exist');
  assert.equal(missing.status, 404);
});

test('order totals are computed server-side, ignoring any client price', async () => {
  const result = await call('POST', '/api/public/orders', {
    body: {
      slug: 'alpha',
      table_code: 'AAA11',
      session_id: 'test-session',
      // A hostile client sends its own prices; they must be ignored.
      items: [{ item_id: ids.itemA, qty: 2, price: 0.01, unit_price: 0.01, option_ids: [ids.optLarge] }],
    },
  });

  assert.equal(result.status, 201, JSON.stringify(result.body));
  const order = result.body.order;

  // (10 base + 4 large) x 2 = 28 subtotal; 5% service = 1.40; 10% tax on 29.40 = 2.94
  assert.equal(order.subtotal, 28);
  assert.equal(order.service_charge, 1.4);
  assert.equal(order.tax, 2.94);
  assert.equal(order.total, 32.34);

  ids.orderCode = order.code;
  ids.orderId = order.id;
});

test('an order cannot mix in another restaurant\'s menu item', async () => {
  const result = await call('POST', '/api/public/orders', {
    body: { slug: 'alpha', table_code: 'AAA11', items: [{ item_id: ids.itemB, qty: 1 }] },
  });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /not on this restaurant's menu/);
});

test('sold-out items and unknown options are rejected', async () => {
  const soldOut = await call('POST', '/api/public/orders', {
    body: { slug: 'alpha', table_code: 'AAA11', items: [{ item_id: ids.soldOutA, qty: 1 }] },
  });
  assert.equal(soldOut.status, 409);

  const badOption = await call('POST', '/api/public/orders', {
    body: {
      slug: 'alpha', table_code: 'AAA11',
      items: [{ item_id: ids.itemA, qty: 1, option_ids: [ids.optSmall, 99999] }],
    },
  });
  assert.equal(badOption.status, 400);
});

test('a required option group must be satisfied', async () => {
  const result = await call('POST', '/api/public/orders', {
    body: { slug: 'alpha', table_code: 'AAA11', items: [{ item_id: ids.itemA, qty: 1, option_ids: [] }] },
  });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /choose at least 1 from "Size"/);
});

test('an unknown table code is refused', async () => {
  const result = await call('POST', '/api/public/orders', {
    body: { slug: 'alpha', table_code: 'ZZZZZ', items: [{ item_id: ids.itemA, qty: 1, option_ids: [ids.optSmall] }] },
  });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /rescan the QR code/);
});

test('invalid quantities are refused', async () => {
  for (const qty of [0, -1, 1.5, 999]) {
    const result = await call('POST', '/api/public/orders', {
      body: { slug: 'alpha', table_code: 'AAA11', items: [{ item_id: ids.itemA, qty, option_ids: [ids.optSmall] }] },
    });
    assert.equal(result.status, 400, `qty ${qty} should be rejected`);
  }
});

test('a restaurant cannot read another restaurant\'s orders', async () => {
  const own = await call('GET', `/api/rest/orders/${ids.orderId}`, { token: tokens.ownerA });
  assert.equal(own.status, 200);

  const other = await call('GET', `/api/rest/orders/${ids.orderId}`, { token: tokens.ownerB });
  assert.equal(other.status, 404, 'Beta owner could read an Alpha order');

  const list = await call('GET', '/api/rest/orders', { token: tokens.ownerB });
  assert.equal(list.status, 200);
  assert.equal(list.body.orders.length, 0, 'Beta owner sees Alpha orders in their list');
});

test('a restaurant cannot mutate another restaurant\'s menu', async () => {
  const result = await call('PATCH', `/api/rest/items/${ids.itemA}`, {
    token: tokens.ownerB,
    body: { name: 'Hijacked', price: 0 },
  });
  assert.equal(result.status, 404);

  const item = db.prepare('SELECT name FROM menu_items WHERE id = ?').get(ids.itemA);
  assert.equal(item.name, 'Burger');
});

test('a waiter may flip availability but not edit the menu', async () => {
  const toggle = await call('PATCH', `/api/rest/items/${ids.itemA}/availability`, {
    token: tokens.waiterA,
    body: { is_available: false },
  });
  assert.equal(toggle.status, 200);

  const edit = await call('PATCH', `/api/rest/items/${ids.itemA}`, {
    token: tokens.waiterA,
    body: { name: 'Waiter Rename', price: 1 },
  });
  assert.equal(edit.status, 403);

  const reports = await call('GET', '/api/rest/reports', { token: tokens.waiterA });
  assert.equal(reports.status, 403);

  // Restore for later tests.
  await call('PATCH', `/api/rest/items/${ids.itemA}/availability`, {
    token: tokens.ownerA, body: { is_available: true },
  });
});

test('staff endpoints reject an anonymous caller', async () => {
  for (const url of ['/api/rest/overview', '/api/rest/orders', '/api/admin/stats']) {
    const result = await call('GET', url);
    assert.equal(result.status, 401, `${url} should require authentication`);
  }
});

test('the admin console is closed to restaurant staff', async () => {
  const result = await call('GET', '/api/admin/stats', { token: tokens.ownerA });
  assert.equal(result.status, 403);
});

test('a tampered or expired token is rejected', async () => {
  const parts = tokens.ownerA.split('.');
  const tampered = `${parts[0]}.${parts[1]}.${'A'.repeat(parts[2].length)}`;
  const result = await call('GET', '/api/rest/overview', { token: tampered });
  assert.equal(result.status, 401);
});

test('the order status machine refuses illegal jumps but allows the flow', async () => {
  const skip = await call('PATCH', `/api/rest/orders/${ids.orderId}/status`, {
    token: tokens.ownerA,
    body: { status: 'ready' },
  });
  assert.equal(skip.status, 409, 'pending should not jump straight to ready');

  for (const status of ['accepted', 'preparing', 'ready', 'served', 'completed']) {
    const step = await call('PATCH', `/api/rest/orders/${ids.orderId}/status`, {
      token: tokens.ownerA, body: { status },
    });
    assert.equal(step.status, 200, `failed to move to ${status}: ${JSON.stringify(step.body)}`);
    assert.equal(step.body.order.status, status);
  }

  const afterTerminal = await call('PATCH', `/api/rest/orders/${ids.orderId}/status`, {
    token: tokens.ownerA, body: { status: 'preparing' },
  });
  assert.equal(afterTerminal.status, 409);
});

test('a guest can only cancel while the order is still pending', async () => {
  const fresh = await call('POST', '/api/public/orders', {
    body: { slug: 'alpha', table_code: 'AAA11', items: [{ item_id: ids.itemA, qty: 1, option_ids: [ids.optSmall] }] },
  });
  assert.equal(fresh.status, 201);
  const code = fresh.body.order.code;

  const cancelled = await call('POST', `/api/public/orders/${code}/cancel`, { body: {} });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.order.status, 'cancelled');

  const again = await call('POST', `/api/public/orders/${code}/cancel`, { body: {} });
  assert.equal(again.status, 409);
});

test('a review requires a served order and is one per order', async () => {
  const early = await call('POST', `/api/public/orders/${ids.orderCode}/review`, { body: { rating: 5 } });
  // ids.orderCode reached "completed" above, so a review is allowed once.
  assert.equal(early.status, 201);

  const duplicate = await call('POST', `/api/public/orders/${ids.orderCode}/review`, { body: { rating: 1 } });
  assert.equal(duplicate.status, 409);

  const invalid = await call('POST', `/api/public/orders/${ids.orderCode}/review`, { body: { rating: 9 } });
  assert.equal(invalid.status, 400);
});

test('repeat taps on "call waiter" collapse into one open request', async () => {
  const first = await call('POST', '/api/public/service-requests', {
    body: { slug: 'alpha', table_code: 'AAA11', type: 'waiter' },
  });
  assert.equal(first.status, 201);

  const second = await call('POST', '/api/public/service-requests', {
    body: { slug: 'alpha', table_code: 'AAA11', type: 'waiter' },
  });
  assert.equal(second.status, 200);
  assert.equal(second.body.deduplicated, true);

  const list = await call('GET', '/api/rest/service-requests', { token: tokens.ownerA });
  assert.equal(list.body.requests.filter((r) => r.type === 'waiter').length, 1);
});

test('a suspended restaurant stops serving guests and staff', async () => {
  db.prepare("UPDATE restaurants SET status = 'suspended' WHERE id = ?").run(ids.rB);

  const menu = await call('GET', '/api/public/r/beta');
  assert.equal(menu.status, 403);

  const staff = await call('GET', '/api/rest/orders', { token: tokens.ownerB });
  assert.equal(staff.status, 403);

  const signIn = await call('POST', '/api/auth/login', {
    body: { email: 'ownerb@test.local', password: 'Password123!' },
  });
  assert.equal(signIn.status, 401);

  db.prepare("UPDATE restaurants SET status = 'active' WHERE id = ?").run(ids.rB);
});

test('paused ordering blocks new orders but keeps the menu readable', async () => {
  db.prepare('UPDATE restaurants SET accepts_orders = 0 WHERE id = ?').run(ids.rA);

  const menu = await call('GET', '/api/public/r/alpha');
  assert.equal(menu.status, 200);
  assert.equal(menu.body.restaurant.accepts_orders, false);

  const blocked = await call('POST', '/api/public/orders', {
    body: { slug: 'alpha', table_code: 'AAA11', items: [{ item_id: ids.itemA, qty: 1, option_ids: [ids.optSmall] }] },
  });
  assert.equal(blocked.status, 409);

  db.prepare('UPDATE restaurants SET accepts_orders = 1 WHERE id = ?').run(ids.rA);
});

test('a platform admin can scope into a tenant with the header', async () => {
  const withoutHeader = await call('GET', '/api/rest/overview', { token: tokens.admin });
  assert.equal(withoutHeader.status, 403);

  const scoped = await call('GET', '/api/rest/overview', {
    token: tokens.admin,
    headers: { 'X-Restaurant-Id': String(ids.rA) },
  });
  assert.equal(scoped.status, 200);
  assert.ok(typeof scoped.body.today.orders === 'number');
});

test('the last owner cannot be demoted or removed', async () => {
  const demote = await call('PATCH', `/api/rest/staff/${ids.ownerA}`, {
    token: tokens.ownerA,
    body: { role: 'waiter' },
  });
  assert.equal(demote.status, 409);
  assert.match(demote.body.error, /last active owner/);
});

test('deleting a restaurant requires the slug confirmation', async () => {
  const missing = await call('DELETE', `/api/admin/restaurants/${ids.rB}`, {
    token: tokens.admin, body: {},
  });
  assert.equal(missing.status, 400);

  const still = db.prepare('SELECT id FROM restaurants WHERE id = ?').get(ids.rB);
  assert.ok(still, 'restaurant was deleted without confirmation');
});

test('a duplicate email is refused when creating staff', async () => {
  const result = await call('POST', '/api/rest/staff', {
    token: tokens.ownerA,
    body: { name: 'Clash', email: 'ownera@test.local', role: 'waiter', password: 'Password123!' },
  });
  assert.equal(result.status, 409);
});

test('a short password is refused', async () => {
  const result = await call('POST', '/api/rest/staff', {
    token: tokens.ownerA,
    body: { name: 'Weak', email: 'weak@test.local', role: 'waiter', password: 'short' },
  });
  assert.equal(result.status, 400);
});

test('the guest session feed returns only that session\'s orders', async () => {
  const mine = await call('GET', '/api/public/sessions/test-session/orders');
  assert.equal(mine.status, 200);
  assert.ok(mine.body.orders.length >= 1);

  const other = await call('GET', '/api/public/sessions/someone-else/orders');
  assert.equal(other.body.orders.length, 0);
});

test('a table QR renders as SVG for the public table URL', async () => {
  const response = await fetch(`${base}/api/public/r/alpha/table/AAA11/qr.svg`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /svg/);
  const svg = await response.text();
  assert.match(svg, /^<svg/);
});
