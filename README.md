# Menu — restaurant QR ordering platform

A complete, self-contained ordering system of the kind you meet in a restaurant:
**a QR code sits on the table, the guest scans it, picks their food, and it
arrives at that table.** Everything around that moment is here too — the kitchen
display, the waiter's board, the manager's menu editor and reports, and a
platform console for running many restaurants at once.

Multi-tenant, real-time, and runs on one Node process with a SQLite file.

```bash
npm install
npm run seed      # demo restaurants, menus, staff and a month of order history
npm start         # http://localhost:3000
```

---

## The four people it is built for

| Who | Where they work | What they get |
|---|---|---|
| **Guest** | Their own phone, after scanning | Menu, options and extras, cart, live order tracking, call a waiter, request the bill, leave a review |
| **Waiter** | `/dashboard/orders.html` | Order board, table map and status, guest requests, mark dishes sold out |
| **Kitchen** | `/dashboard/kitchen.html` | Ticket lanes, oldest first, colour-coded by how long they have waited, audible on new orders |
| **Owner / manager** | `/dashboard/` | Everything above plus the menu editor, QR sheets, staff accounts, sales reports and settings |
| **Platform admin** | `/admin/` | Onboard and suspend restaurants, manage every account, cross-tenant order feed, audit log |

---

## Demo accounts

Created by `npm run seed`.

| Role | Email | Password |
|---|---|---|
| Platform admin | `admin@menu.app` | `Admin123!` |
| Owner | `owner@zaytoun.test` | `Owner123!` |
| Manager | `manager@zaytoun.test` | `Manager123!` |
| Waiter | `waiter@zaytoun.test` | `Waiter123!` |
| Kitchen | `kitchen@zaytoun.test` | `Kitchen123!` |
| Second restaurant | `owner@bella.test` | `Owner123!` |

The home page lists a live table link for each demo restaurant, so you can try
the guest side without a phone. The seed script prints one too.

---

## The guest journey

```
QR sticker  →  /t/<restaurant-slug>/<table-code>
                 │
                 ├─ menu, filtered to what is actually available
                 ├─ dish sheet: sizes, extras, quantity, note to the kitchen
                 ├─ cart with live subtotal, service charge and tax
                 └─ send  →  /order/<code>
                               ├─ live status over Server-Sent Events
                               ├─ receipt
                               ├─ call a waiter / water / the bill
                               ├─ cancel (only while still pending)
                               └─ review, once served
```

No app install and no guest account. A browser-local session id lets someone
see their own past orders at `/orders`.

---

## Pages

**Guest** — `/` landing · `/t/:slug/:table` menu · `/r/:slug` menu preview ·
`/order/:code` tracking · `/orders` history · `/login` · `404`

**Restaurant** — `/dashboard/` overview · `orders.html` board ·
`kitchen.html` display · `menu.html` editor · `tables.html` tables and QR sheet ·
`requests.html` guest calls · `reports.html` · `staff.html` · `settings.html`

**Platform** — `/admin/` overview · `restaurants.html` · `users.html` ·
`orders.html` · `audit.html`

---

## How it is built

- **Server** — Node + Express 5, three dependencies total
  (`express`, `better-sqlite3`, `qrcode`).
- **Database** — SQLite via `better-sqlite3`, WAL mode, foreign keys on.
  The schema in `server/db/schema.sql` is applied on every boot and is
  idempotent, so a fresh clone runs with no migration step.
- **Auth** — HS256 JWTs signed with `node:crypto`; passwords hashed with
  `scrypt` and compared in constant time. No auth library.
- **Real time** — Server-Sent Events. `restaurant:<id>` feeds the staff screens,
  `order:<code>` feeds the guest's tracking page. Reconnection backs off
  automatically.
- **Front end** — no framework, no build step. Plain ES2020 modules served
  statically, a shared design system in one stylesheet, and a small SVG chart
  library. The Content-Security-Policy forbids inline script and any external
  origin, so every script is a real file under `public/assets/js`.

### Layout

```
server/
  index.js              app wiring, security headers, friendly guest URLs
  config.js             env loading with safe development defaults
  db/
    schema.sql          the whole data model, commented
    index.js            connection + idempotent migrate
    seed.js             demo tenants, menus and 30 days of orders
  lib/                  jwt · password · validate · events (SSE) · audit · errors
  middleware/           auth guards, error handling
  services/
    menu.js             menu tree assembly
    orders.js           pricing, creation, status machine
  routes/
    auth.js             sign in, whoami, change password
    public.js           everything a guest touches
    restaurant.js       menu, tables, staff, orders, reports, settings
    admin.js            tenants, users, cross-tenant feeds, audit
public/
  assets/css/app.css    design system, light + dark
  assets/js/core.js     DOM builder, API client, auth, modals, toasts, SSE
  assets/js/shell.js    dashboard/admin chrome and role-aware navigation
  assets/js/charts.js   area-line, columns, ranked bars, segmented bar
  assets/js/pages/      one script per page
test/api.test.js        28 API tests
```

---

## Rules the system enforces

These are the parts worth knowing before trusting it with money, and each one
has a test in `test/api.test.js`.

- **Prices are never taken from the client.** The cart is re-priced from the
  database on every order: item price, each selected option's delta, the
  restaurant's service charge, then tax on subtotal + service charge.
- **Option groups are validated server-side** — minimum and maximum selections,
  and every option id must belong to that dish.
- **Sold-out items and out-of-service tables are refused** at order time, not
  just hidden in the UI.
- **Tenants are isolated.** Every business row carries `restaurant_id`, and
  staff endpoints resolve a single tenant before any query runs. One
  restaurant's owner cannot read or modify another's orders, menu or staff.
- **Orders move forward through a status machine**
  (`pending → accepted → preparing → ready → served → completed`, with
  `cancelled` reachable from any live state). Illegal jumps are rejected;
  owners and managers can override deliberately with `force`.
- **Guests can cancel only while an order is still pending.** After the kitchen
  accepts it, cancellation is a staff action.
- **The last owner cannot be demoted, disabled or deleted**, and the last
  platform admin cannot be disabled — no account can lock itself out.
- **Deleting a restaurant requires typing its slug**, because it cascades to the
  menu, tables, staff and full order history.
- **Suspending a restaurant** signs its staff out and takes the public menu
  offline immediately.

### Roles

| | Guest menu | Orders | Sold-out toggle | Menu editing | Tables | Staff | Reports | Settings | Platform |
|---|---|---|---|---|---|---|---|---|---|
| `kitchen` | | ✓ | ✓ | | | | | | |
| `waiter` | | ✓ | ✓ | | status only | | | | |
| `manager` | | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `owner` | | ✓ | ✓ | ✓ | ✓ | ✓ (incl. owners) | ✓ | ✓ | |
| `super_admin` | | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

A platform admin can open any tenant's dashboard from
`/admin/restaurants.html`. A banner stays on screen for the whole session so
the context is never ambiguous.

---

## QR codes

Each table owns a short, non-sequential code. Its QR encodes
`PUBLIC_BASE_URL/t/<slug>/<code>`.

- **Print them**: *Tables & QR codes → QR sheet → Print*. One card per table,
  laid out three across on paper.
- **Download one**: the QR dialog offers a 1000px PNG.
- **Rotate a code** if a printed sticker is copied or misused — the old QR stops
  working immediately.

Set `PUBLIC_BASE_URL` to an address the guest's phone can actually reach.
`localhost` works on your own machine but not from a phone; use your LAN IP or
a real domain, then reprint.

---

## Configuration

Copy `.env.example` to `.env`. Every value has a development default.

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | |
| `JWT_SECRET` | dev-only value | **Required in production** — the server refuses to start with the default when `NODE_ENV=production`. |
| `JWT_TTL` | `604800` | Access token lifetime, seconds. |
| `DATABASE_FILE` | `./data/menu.db` | |
| `PUBLIC_BASE_URL` | `http://localhost:$PORT` | Baked into every QR code. |

---

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Run the server |
| `npm run dev` | Run with `--watch` |
| `npm run seed` | Seed demo data (skips if data already exists) |
| `npm run reset` | Wipe and reseed |
| `npm test` | API test suite |

---

## Notes and limits

Things a production deployment would want next, stated plainly rather than
implied:

- **Payments are recorded, not processed.** An order carries a payment status
  and method that staff set by hand. There is no card processor integration.
- **No rate limiting.** The public order endpoint is open by design (guests have
  no account); put a rate limiter or WAF in front of it before exposing it to
  the internet.
- **Single process, single file.** SQLite and the in-memory SSE bus assume one
  Node process. Scaling horizontally means moving to Postgres and a shared
  pub/sub — `server/lib/events.js` is the only file that would change for the
  latter.
- **Gross volume in the platform console** sums every tenant regardless of their
  own currency, so read it as a relative indicator, not an accounting figure.
- **Images are referenced by URL.** There is no upload pipeline; the menu editor
  takes an image URL, and dishes without one fall back to their category emoji.
