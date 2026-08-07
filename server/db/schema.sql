-- =====================================================================
-- Menu — QR ordering platform schema
--
-- Multi-tenant: every business row carries restaurant_id. The platform
-- operator (super_admin) is the only user with restaurant_id = NULL.
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- Tenants
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS restaurants (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT    NOT NULL,
  -- Optional Arabic copy. Empty means "fall back to the primary field".
  name_ar             TEXT    NOT NULL DEFAULT '',
  slug                TEXT    NOT NULL UNIQUE,
  description         TEXT    NOT NULL DEFAULT '',
  description_ar      TEXT    NOT NULL DEFAULT '',
  cuisine             TEXT    NOT NULL DEFAULT '',
  logo_url            TEXT    NOT NULL DEFAULT '',
  cover_url           TEXT    NOT NULL DEFAULT '',
  phone               TEXT    NOT NULL DEFAULT '',
  email               TEXT    NOT NULL DEFAULT '',
  address             TEXT    NOT NULL DEFAULT '',
  currency            TEXT    NOT NULL DEFAULT 'USD',
  -- Stored as a fraction: 0.15 means 15%
  tax_rate            REAL    NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 1),
  service_charge_rate REAL    NOT NULL DEFAULT 0 CHECK (service_charge_rate >= 0 AND service_charge_rate <= 1),
  primary_color       TEXT    NOT NULL DEFAULT '#e2603f',
  -- active | suspended | pending
  status              TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','pending')),
  plan                TEXT    NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro','enterprise')),
  -- Master switch the manager can flip to stop taking orders (e.g. closing time)
  accepts_orders      INTEGER NOT NULL DEFAULT 1,
  -- Require staff to accept an order before the kitchen sees it
  auto_accept_orders  INTEGER NOT NULL DEFAULT 0,
  -- Let guests pay from their phone instead of settling with a staff member
  online_payments_enabled INTEGER NOT NULL DEFAULT 0,
  opening_hours       TEXT    NOT NULL DEFAULT '',
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------
-- Staff & platform users
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER REFERENCES restaurants(id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE,
  phone         TEXT    NOT NULL DEFAULT '',
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK (role IN ('super_admin','owner','manager','waiter','kitchen')),
  status        TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  last_login_at TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_restaurant ON users(restaurant_id);

-- ---------------------------------------------------------------------
-- Dining tables — each one owns the QR code customers scan
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tables (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  label         TEXT    NOT NULL,
  -- Short opaque code embedded in the QR URL
  code          TEXT    NOT NULL,
  seats         INTEGER NOT NULL DEFAULT 4,
  zone          TEXT    NOT NULL DEFAULT 'Main',
  status        TEXT    NOT NULL DEFAULT 'free' CHECK (status IN ('free','occupied','reserved','inactive')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (restaurant_id, code)
);
CREATE INDEX IF NOT EXISTS idx_tables_restaurant ON tables(restaurant_id);

-- ---------------------------------------------------------------------
-- Menu structure
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,
  name_ar       TEXT    NOT NULL DEFAULT '',
  description   TEXT    NOT NULL DEFAULT '',
  description_ar TEXT   NOT NULL DEFAULT '',
  icon          TEXT    NOT NULL DEFAULT '',
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_categories_restaurant ON categories(restaurant_id);

CREATE TABLE IF NOT EXISTS menu_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  name          TEXT    NOT NULL,
  name_ar       TEXT    NOT NULL DEFAULT '',
  description   TEXT    NOT NULL DEFAULT '',
  description_ar TEXT   NOT NULL DEFAULT '',
  price         REAL    NOT NULL CHECK (price >= 0),
  image_url     TEXT    NOT NULL DEFAULT '',
  is_available  INTEGER NOT NULL DEFAULT 1,
  is_featured   INTEGER NOT NULL DEFAULT 0,
  prep_minutes  INTEGER NOT NULL DEFAULT 10,
  calories      INTEGER,
  -- JSON array of free-form labels: ["spicy","vegan"]
  tags          TEXT    NOT NULL DEFAULT '[]',
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_items_restaurant ON menu_items(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_items_category ON menu_items(category_id);

-- Customisation, e.g. "Choose a size" (required, pick 1) or "Extras" (pick up to 5)
CREATE TABLE IF NOT EXISTS option_groups (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id       INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,
  name_ar       TEXT    NOT NULL DEFAULT '',
  min_select    INTEGER NOT NULL DEFAULT 0,
  max_select    INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_option_groups_item ON option_groups(item_id);

CREATE TABLE IF NOT EXISTS options (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id      INTEGER NOT NULL REFERENCES option_groups(id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,
  name_ar       TEXT    NOT NULL DEFAULT '',
  price_delta   REAL    NOT NULL DEFAULT 0,
  is_available  INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_options_group ON options(group_id);

-- ---------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id  INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  table_id       INTEGER REFERENCES tables(id) ON DELETE SET NULL,
  -- Human friendly public tracking code, e.g. "A7F3QK"
  code           TEXT    NOT NULL UNIQUE,
  status         TEXT    NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','accepted','preparing','ready','served','completed','cancelled')),
  type           TEXT    NOT NULL DEFAULT 'dine_in' CHECK (type IN ('dine_in','takeaway')),
  customer_name  TEXT    NOT NULL DEFAULT '',
  customer_phone TEXT    NOT NULL DEFAULT '',
  note           TEXT    NOT NULL DEFAULT '',
  subtotal       REAL    NOT NULL DEFAULT 0,
  tax            REAL    NOT NULL DEFAULT 0,
  service_charge REAL    NOT NULL DEFAULT 0,
  discount       REAL    NOT NULL DEFAULT 0,
  total          REAL    NOT NULL DEFAULT 0,
  payment_status TEXT    NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid','refunded')),
  payment_method TEXT    NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','card','online')),
  -- Anonymous browser identity so a guest can list their own orders
  session_id     TEXT    NOT NULL DEFAULT '',
  -- Provider-side id for an online payment, blank for cash/card at the table
  payment_reference TEXT NOT NULL DEFAULT '',
  cancel_reason  TEXT    NOT NULL DEFAULT '',
  placed_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_restaurant ON orders(restaurant_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_placed ON orders(placed_at);
CREATE INDEX IF NOT EXISTS idx_orders_session ON orders(session_id);

CREATE TABLE IF NOT EXISTS order_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id         INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id          INTEGER REFERENCES menu_items(id) ON DELETE SET NULL,
  -- Name/price are snapshotted so history survives menu edits
  name_snapshot    TEXT    NOT NULL,
  unit_price       REAL    NOT NULL,
  qty              INTEGER NOT NULL CHECK (qty > 0),
  -- JSON array: [{"group":"Size","name":"Large","price_delta":2}]
  options_snapshot TEXT    NOT NULL DEFAULT '[]',
  note             TEXT    NOT NULL DEFAULT '',
  line_total       REAL    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- Status timeline shown to both the customer and the staff
CREATE TABLE IF NOT EXISTS order_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id       INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status         TEXT    NOT NULL,
  note           TEXT    NOT NULL DEFAULT '',
  actor_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id);

-- ---------------------------------------------------------------------
-- "Call the waiter" / "bring the bill" buttons
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  table_id      INTEGER REFERENCES tables(id) ON DELETE SET NULL,
  order_id      INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  type          TEXT    NOT NULL CHECK (type IN ('waiter','bill','water','cleanup')),
  status        TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  note          TEXT    NOT NULL DEFAULT '',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  resolved_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_requests_restaurant ON service_requests(restaurant_id, status);

-- ---------------------------------------------------------------------
-- Post-meal feedback
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reviews (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       TEXT    NOT NULL DEFAULT '',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (order_id)
);
CREATE INDEX IF NOT EXISTS idx_reviews_restaurant ON reviews(restaurant_id);

-- ---------------------------------------------------------------------
-- Online payments
--
-- One row per attempt, so a retry after a decline leaves a trail. The
-- order's payment_status stays the single source of truth for "is it paid".
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  -- Opaque reference the guest's browser holds while paying
  reference     TEXT    NOT NULL UNIQUE,
  provider      TEXT    NOT NULL DEFAULT 'mock',
  -- Provider's own identifier, e.g. a Stripe PaymentIntent id
  provider_ref  TEXT    NOT NULL DEFAULT '',
  amount        REAL    NOT NULL,
  currency      TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'requires_payment'
                CHECK (status IN ('requires_payment','processing','succeeded','failed','cancelled','refunded')),
  failure_reason TEXT   NOT NULL DEFAULT '',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_restaurant ON payments(restaurant_id, status);

-- ---------------------------------------------------------------------
-- Who changed what (platform + restaurant admin actions)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_email   TEXT    NOT NULL DEFAULT '',
  restaurant_id INTEGER REFERENCES restaurants(id) ON DELETE SET NULL,
  action        TEXT    NOT NULL,
  entity        TEXT    NOT NULL DEFAULT '',
  entity_id     TEXT    NOT NULL DEFAULT '',
  meta          TEXT    NOT NULL DEFAULT '{}',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
