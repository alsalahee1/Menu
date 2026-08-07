# Menu — restaurant QR ordering platform

A complete, self-contained ordering system of the kind you meet in a restaurant:
**a QR code sits on the table, the guest scans it, picks their food, and it
arrives at that table.** Everything around that moment is here too — the kitchen
display, the waiter's board, the manager's menu editor and reports, and a
platform console for running many restaurants at once.

Multi-tenant, real-time, bilingual (English / العربية with full RTL), and runs
on one Node process with a SQLite file.

```bash
npm install
npm run seed      # demo restaurants, menus, staff and a month of order history
npm start         # http://localhost:3000
```

---

## The four people it is built for

| Who | Where they work | What they get |
|---|---|---|
| **Guest** | Their own phone, after scanning | Menu, options and extras, cart, live order tracking, pay from the table, call a waiter, request the bill, leave a review |
| **Waiter** | `/dashboard/orders.html` | Order board, table map and status, guest requests, mark dishes sold out |
| **Kitchen** | `/dashboard/kitchen.html` | Ticket lanes, oldest first, colour-coded by how long they have waited, audible on new orders |
| **Owner / manager** | `/dashboard/` | Everything above plus the menu editor (with image upload and Arabic copy), QR sheets, staff accounts, sales reports and settings |
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
                               ├─ pay from the phone (when enabled)
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
  middleware/           auth guards, rate limiting, error handling
  services/
    menu.js             menu tree assembly
    orders.js           pricing, creation, status machine
    payments.js         payment intents, mock + Stripe providers, refunds
  routes/
    auth.js             sign in, whoami, change password
    public.js           everything a guest touches
    restaurant.js       menu, tables, staff, orders, reports, settings
    admin.js            tenants, users, cross-tenant feeds, audit
    uploads.js          dish image upload with magic-byte validation
public/
  assets/css/app.css    design system, light + dark, LTR + RTL
  assets/js/i18n.js     English/Arabic dictionary, RTL switching, t()
  assets/js/core.js     DOM builder, API client, auth, modals, toasts, SSE
  assets/js/shell.js    dashboard/admin chrome and role-aware navigation
  assets/js/charts.js   area-line, columns, ranked bars, segmented bar
  assets/js/pages/      one script per page
test/api.test.js        42 API tests
Dockerfile              multi-stage production image
docker-compose.yml      one container plus a persistent volume
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
- **An order cannot be paid twice.** A payment intent is reused across page
  refreshes, a settled order refuses further charges, and every attempt —
  including declines — is recorded.
- **Uploads are validated by content, not by filename or content type.**

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

## Languages and right-to-left

The whole product ships in **English and Arabic**. A switch sits in the guest
header and in the dashboard sidebar; the choice is remembered per browser, and
`?lang=ar` forces it on first visit so an Arabic-first QR link can be printed.

- **Layout mirrors properly.** The stylesheet is written with logical properties
  (`inline-start`, `inline-end`), so RTL is a real mirror rather than a
  right-aligned LTR page — including the sidebar, tables, timeline and the
  mobile drawer.
- **Charts stay left-to-right.** Time runs left to right in both languages;
  mirroring a trend line would invert its meaning.
- **Codes and prices stay left-to-right** inside Arabic text, so an order code
  like `A7F3QK` is never visually reordered.
- **Latin digits are used in Arabic** (`ar-u-nu-latn`). Prices, table numbers
  and order codes are read in Latin numerals across most of the region, and
  mixing numeral systems on a receipt invites mistakes.
- **Menu content is bilingual per field.** Categories, dishes, option groups and
  options each take an optional Arabic name and description in the menu editor.
  An empty Arabic field falls back to the primary text, so a restaurant can
  translate as much or as little as it wants.

Adding a third language means adding a column to `STRINGS` in
`public/assets/js/i18n.js` and a `_xx` column per translatable field.

---

## Paying from the table

Guests can settle the bill on their phone instead of waiting for a staff member.
Turn it on per restaurant in **Settings → Ordering**.

Two providers share one interface:

| Provider | When it is used | What it does |
|---|---|---|
| `mock` | Default | **Simulates** an authorisation locally so the whole flow is demonstrable and testable offline. No money moves and no real card is involved. |
| `stripe` | `STRIPE_SECRET_KEY` is set | Creates a real PaymentIntent over Stripe's REST API using `fetch` — no SDK dependency. |

The flow is intent → confirm → settle. Every attempt is recorded in the
`payments` table, so a decline followed by a retry leaves a trail; the order's
`payment_status` remains the single source of truth for "is it paid". Refunding
an order that settled online goes back through the provider rather than just
flipping a column.

The simulator's test cards are shown in the payment sheet: `4242…4242` approves,
`4000…0002` declines, `4000…9995` reports insufficient funds.

**The dashboard says plainly which provider is active**, so nobody mistakes the
simulator for live payments.

---

## Deployment

```bash
cp .env.example .env         # set JWT_SECRET and PUBLIC_BASE_URL
docker compose up -d --build
docker compose exec app npm run seed    # optional demo data
```

The image is multi-stage (`node:22-bookworm-slim`), runs as the non-root `node`
user, and carries a `HEALTHCHECK`. CI builds it, runs it, waits for health and
seeds inside the container on every push, so the native `better-sqlite3` step
and the non-root file permissions are verified continuously rather than assumed. The database and uploaded images both live
under `/data`, so a single volume covers all persistent state and a redeploy
keeps everything.

**Behind a reverse proxy**, set `TRUST_PROXY` to match your hop count or CIDR —
otherwise every request appears to come from the proxy and the rate limiter
becomes a single global counter. Set `FORCE_HTTPS=true` to send HSTS and
redirect plain HTTP.

`SIGTERM` drains in-flight requests before exit, so a rolling deploy never drops
an order mid-write.

### Rate limits

Applied per client IP, in memory:

| Endpoint | Budget |
|---|---|
| Sign-in | 20 per 15 minutes |
| Place an order | 20 per 10 minutes |
| Payment endpoints | 30 per 10 minutes |
| Service requests | 30 per 10 minutes |
| Lead form | 5 per hour |
| Everything else under `/api` | 600 per minute |

Responses carry `RateLimit-*` headers and a `Retry-After` when the budget is
spent.

### Dish images

The menu editor uploads straight to `/api/uploads/image`, which takes the raw
file as the request body — no multipart parser, no dependency. Uploads are:

- **restricted to owners and managers**, and rate limited;
- **validated by magic bytes**, not the declared content type, so a script
  renamed `.png` is refused;
- **content-addressed** (`<restaurant>-<sha256>.<ext>`), so re-uploading the
  same picture reuses one file;
- **served sandboxed** with `nosniff`, `Content-Disposition: inline` and a
  `default-src 'none'; sandbox` CSP of their own.

A URL can still be pasted instead, for restaurants already hosting their images.

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
| `UPLOAD_DIR` | `./data/uploads` | Where dish images are written. |
| `MAX_UPLOAD_BYTES` | `3145728` | Upload size ceiling (3 MB). |
| `STRIPE_SECRET_KEY` | *(empty)* | Set to take real payments; empty uses the simulator. |
| `STRIPE_PUBLISHABLE_KEY` | *(empty)* | Sent to the browser when Stripe is active. |
| `TRUST_PROXY` | `loopback` | Anything Express accepts: `loopback`, a hop count, or a CIDR. |
| `FORCE_HTTPS` | `false` | Send HSTS and redirect plain HTTP. |

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

- **Payments default to a simulator.** Without `STRIPE_SECRET_KEY` the built-in
  `mock` provider approves or declines locally and moves no money. It exists so
  the flow is demonstrable and testable offline — do not mistake it for a live
  integration. The Stripe path creates real PaymentIntents but has been
  exercised only against the API contract, not a live account, and it has **no
  webhook handler**: settlement relies on the browser calling `/sync` after the
  provider reports success. Add a webhook before taking real money, or an
  abandoned tab leaves a paid charge against an unpaid order.
- **Rate limiting is per process and in memory.** It stops a script hammering
  the order endpoint; it is not a defence against a distributed attacker, and
  the counters reset on restart. Move to a shared store (Redis) once more than
  one process serves traffic.
- **Single process, single file.** SQLite, the in-memory SSE bus and the rate
  limiter all assume one Node process. Scaling horizontally means moving to
  Postgres and a shared pub/sub — `server/lib/events.js` and
  `server/middleware/rateLimit.js` are the files that would change.
- **Uploaded images are not resized or re-encoded.** A 3 MB photo is served at
  3 MB. Put a CDN or an image pipeline in front for a busy menu.
- **This app does not run on serverless hosts** (Vercel, Netlify Functions,
  Cloudflare Workers). SQLite on local disk, Server-Sent Events and the
  in-memory pub/sub and rate limiter all assume one long-lived process. A
  zero-config Vercel deploy serves `public/` as static files and every
  `/api/*` call 404s — it looks deployed and does nothing. Use a host that
  keeps a Node process alive: Railway, Render, Fly.io, or any VPS with the
  `Dockerfile`.
- **Gross volume in the platform console** sums every tenant regardless of their
  own currency, so read it as a relative indicator, not an accounting figure.
- **Arabic covers the interface, not restaurant data you have not translated.**
  Untranslated dish names fall back to the primary text rather than being
  machine-translated.
