'use strict';

/**
 * Seeds a fully populated demo environment: a platform admin, three
 * restaurants with staff, menus, floor plans, and a month of order history so
 * the reporting screens have something real to show.
 *
 * Usage:  npm run seed          (skip if data already exists)
 *         npm run reset         (wipe first, then seed)
 */

const { db, migrate } = require('./index');
const { hashPassword } = require('../lib/password');
const { randomCode, money } = require('../lib/validate');

const RESET = process.argv.includes('--reset');

// Deterministic PRNG so repeated seeds produce comparable demo numbers.
let seedState = 987654321;
function rand() {
  seedState = (seedState * 1664525 + 1013904223) % 4294967296;
  return seedState / 4294967296;
}
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (min, max) => Math.floor(rand() * (max - min + 1)) + min;

const DEMO = [
  {
    restaurant: {
      name: 'Zaytoun Grill',
      slug: 'zaytoun-grill',
      description: 'Charcoal-grilled kebabs, fresh mezze and stone-baked bread, served all day.',
      cuisine: 'Middle Eastern',
      phone: '+1 555 0142',
      email: 'hello@zaytoungrill.test',
      address: '18 Olive Street, Riverside',
      currency: 'USD',
      tax_rate: 0.05,
      service_charge_rate: 0.1,
      primary_color: '#c9552f',
      plan: 'pro',
      opening_hours: 'Mon–Sun · 11:00 – 23:30',
    },
    staff: [
      { name: 'Layla Haddad', email: 'owner@zaytoun.test', role: 'owner', password: 'Owner123!' },
      { name: 'Omar Fares', email: 'manager@zaytoun.test', role: 'manager', password: 'Manager123!' },
      { name: 'Nadia Aziz', email: 'waiter@zaytoun.test', role: 'waiter', password: 'Waiter123!' },
      { name: 'Chef Karim', email: 'kitchen@zaytoun.test', role: 'kitchen', password: 'Kitchen123!' },
    ],
    tables: 12,
    categories: [
      {
        name: 'Mezze & Starters',
        icon: '🥗',
        description: 'Small plates made to share',
        items: [
          { name: 'Hummus Beiruti', price: 6.5, prep: 6, tags: ['vegan'], calories: 320,
            description: 'Chickpea purée, tahini, lemon, olive oil and warm pita.' },
          { name: 'Baba Ghanoush', price: 7.0, prep: 6, tags: ['vegan'], calories: 280,
            description: 'Smoked aubergine whipped with tahini and pomegranate.' },
          { name: 'Halloumi Skewers', price: 8.5, prep: 9, tags: ['vegetarian'], calories: 410,
            description: 'Grilled halloumi with cherry tomato and za’atar oil.' },
          { name: 'Fattoush Salad', price: 7.5, prep: 5, tags: ['vegan', 'fresh'], calories: 210,
            description: 'Crisp greens, sumac dressing and toasted bread shards.' },
          { name: 'Spicy Muhammara', price: 6.75, prep: 5, tags: ['vegan', 'spicy'], calories: 300,
            description: 'Roasted red pepper and walnut dip with a chilli kick.' },
        ],
      },
      {
        name: 'From the Grill',
        icon: '🔥',
        description: 'Charcoal-fired, cooked to order',
        items: [
          { name: 'Chicken Shish Taouk', price: 16.5, prep: 18, featured: true, calories: 640,
            description: 'Marinated chicken skewers with garlic toum and pickles.',
            groups: [
              { name: 'Choose your side', min: 1, max: 1, options: [
                { name: 'Saffron rice', delta: 0 }, { name: 'Grilled vegetables', delta: 1.5 },
                { name: 'Fries', delta: 0 }, { name: 'Bulgur pilaf', delta: 1 },
              ] },
              { name: 'Extras', min: 0, max: 4, options: [
                { name: 'Extra toum', delta: 0.75 }, { name: 'Grilled chilli', delta: 0.5 },
                { name: 'Double chicken', delta: 6 }, { name: 'Pita basket', delta: 1.5 },
              ] },
            ] },
          { name: 'Lamb Kofta', price: 18.0, prep: 20, featured: true, calories: 780,
            description: 'Hand-minced lamb with parsley and onion, charcoal grilled.',
            groups: [
              { name: 'Spice level', min: 1, max: 1, options: [
                { name: 'Mild', delta: 0 }, { name: 'Medium', delta: 0 }, { name: 'Hot', delta: 0 },
              ] },
            ] },
          { name: 'Mixed Grill Platter', price: 29.0, prep: 25, calories: 1150,
            description: 'Kofta, taouk and lamb cutlet for two, with all the trimmings.' },
          { name: 'Grilled Sea Bass', price: 24.0, prep: 22, calories: 520,
            description: 'Whole sea bass, lemon, olive oil and herb salsa.' },
          { name: 'Falafel Plate', price: 13.5, prep: 12, tags: ['vegan'], calories: 590,
            description: 'Crisp herb falafel, tahini sauce, salad and pickles.' },
        ],
      },
      {
        name: 'Wraps & Sandwiches',
        icon: '🌯',
        items: [
          { name: 'Shawarma Wrap', price: 11.0, prep: 10, calories: 620,
            description: 'Slow-roasted chicken, garlic sauce, pickles, saj bread.',
            groups: [
              { name: 'Protein', min: 1, max: 1, options: [
                { name: 'Chicken', delta: 0 }, { name: 'Beef', delta: 2 }, { name: 'Mushroom', delta: 0 },
              ] },
            ] },
          { name: 'Falafel Wrap', price: 9.5, prep: 8, tags: ['vegan'], calories: 540,
            description: 'Falafel, tahini, tomato and parsley in warm flatbread.' },
          { name: 'Kofta Sandwich', price: 12.0, prep: 12, calories: 680,
            description: 'Grilled kofta with tahini, onion and sumac.' },
        ],
      },
      {
        name: 'Desserts',
        icon: '🍮',
        items: [
          { name: 'Baklava (3 pieces)', price: 6.0, prep: 3, calories: 430,
            description: 'Layered filo, pistachio and orange-blossom syrup.' },
          { name: 'Knafeh', price: 8.0, prep: 10, featured: true, calories: 610,
            description: 'Warm cheese pastry, crisp kataifi and sweet syrup.' },
          { name: 'Rice Pudding', price: 5.5, prep: 3, tags: ['vegetarian'], calories: 320,
            description: 'Rosewater rice pudding with crushed pistachio.' },
        ],
      },
      {
        name: 'Drinks',
        icon: '🥤',
        items: [
          { name: 'Fresh Mint Lemonade', price: 4.5, prep: 3, tags: ['vegan'], calories: 140,
            description: 'Blended lemon, mint and a little sugar.',
            groups: [
              { name: 'Size', min: 1, max: 1, options: [
                { name: 'Regular', delta: 0 }, { name: 'Large', delta: 1.5 },
              ] },
            ] },
          { name: 'Turkish Coffee', price: 3.5, prep: 5, calories: 40,
            description: 'Finely ground, cooked on sand, served with a date.' },
          { name: 'Ayran', price: 3.0, prep: 2, calories: 90, description: 'Chilled salted yoghurt drink.' },
          { name: 'Sparkling Water', price: 2.5, prep: 1, calories: 0, description: '330ml bottle.' },
        ],
      },
    ],
  },
  {
    restaurant: {
      name: 'Bella Napoli',
      slug: 'bella-napoli',
      description: 'Wood-fired Neapolitan pizza, handmade pasta and a short, honest wine list.',
      cuisine: 'Italian',
      phone: '+1 555 0177',
      email: 'ciao@bellanapoli.test',
      address: '4 Garden Row, Old Town',
      currency: 'EUR',
      tax_rate: 0.1,
      service_charge_rate: 0,
      primary_color: '#2f7a4d',
      plan: 'free',
      opening_hours: 'Tue–Sun · 12:00 – 22:00 · Closed Monday',
    },
    staff: [
      { name: 'Marco Rossi', email: 'owner@bella.test', role: 'owner', password: 'Owner123!' },
      { name: 'Giulia Conti', email: 'waiter@bella.test', role: 'waiter', password: 'Waiter123!' },
    ],
    tables: 8,
    categories: [
      {
        name: 'Antipasti',
        icon: '🫒',
        items: [
          { name: 'Bruschetta Classica', price: 6.0, prep: 5, tags: ['vegetarian'], calories: 260,
            description: 'Tomato, basil and garlic on grilled sourdough.' },
          { name: 'Burrata & Prosciutto', price: 11.5, prep: 5, calories: 470,
            description: 'Creamy burrata with 18-month prosciutto crudo.' },
          { name: 'Arancini (4)', price: 8.0, prep: 10, tags: ['vegetarian'], calories: 520,
            description: 'Saffron risotto balls with a molten mozzarella centre.' },
        ],
      },
      {
        name: 'Pizza',
        icon: '🍕',
        description: 'Sixty-second bake at 480°C',
        items: [
          { name: 'Margherita', price: 10.0, prep: 12, featured: true, tags: ['vegetarian'], calories: 780,
            description: 'San Marzano tomato, fior di latte, basil.',
            groups: [
              { name: 'Size', min: 1, max: 1, options: [
                { name: '30 cm', delta: 0 }, { name: '40 cm', delta: 4 },
              ] },
              { name: 'Add toppings', min: 0, max: 5, options: [
                { name: 'Extra mozzarella', delta: 2 }, { name: 'Spicy nduja', delta: 3 },
                { name: 'Mushrooms', delta: 1.5 }, { name: 'Olives', delta: 1 }, { name: 'Rocket', delta: 1.5 },
              ] },
            ] },
          { name: 'Diavola', price: 13.5, prep: 12, tags: ['spicy'], calories: 900,
            description: 'Spicy salami, tomato, mozzarella, chilli oil.' },
          { name: 'Quattro Formaggi', price: 14.0, prep: 12, tags: ['vegetarian'], calories: 980,
            description: 'Mozzarella, gorgonzola, pecorino and smoked scamorza.' },
          { name: 'Marinara', price: 8.5, prep: 10, tags: ['vegan'], calories: 620,
            description: 'Tomato, garlic, oregano, extra virgin olive oil. No cheese.' },
        ],
      },
      {
        name: 'Pasta',
        icon: '🍝',
        items: [
          { name: 'Cacio e Pepe', price: 13.0, prep: 14, tags: ['vegetarian'], calories: 720,
            description: 'Tonnarelli, pecorino romano and cracked black pepper.' },
          { name: 'Ragù Bolognese', price: 15.0, prep: 15, featured: true, calories: 860,
            description: 'Six-hour beef and pork ragù with fresh tagliatelle.' },
          { name: 'Vongole', price: 17.0, prep: 16, calories: 680,
            description: 'Clams, garlic, white wine and parsley.' },
        ],
      },
      {
        name: 'Dolci & Drinks',
        icon: '🍨',
        items: [
          { name: 'Tiramisù', price: 6.5, prep: 3, featured: true, calories: 450,
            description: 'Mascarpone, espresso-soaked savoiardi, cocoa.' },
          { name: 'Affogato', price: 5.5, prep: 3, calories: 260, description: 'Vanilla gelato drowned in espresso.' },
          { name: 'Espresso', price: 2.2, prep: 2, calories: 5, description: 'Single shot, dark roast.' },
          { name: 'House Red (glass)', price: 5.5, prep: 2, calories: 125, description: 'Montepulciano d’Abruzzo.' },
        ],
      },
    ],
  },
  {
    restaurant: {
      name: 'Aroma Coffee House',
      slug: 'aroma-coffee',
      description: 'Speciality coffee, all-day brunch and very good pastries.',
      cuisine: 'Café · Brunch',
      phone: '+1 555 0190',
      email: 'hi@aromacoffee.test',
      address: '77 Market Lane',
      currency: 'USD',
      tax_rate: 0.08,
      service_charge_rate: 0,
      primary_color: '#8a5a3b',
      plan: 'free',
      status: 'pending',
      opening_hours: 'Daily · 07:00 – 18:00',
    },
    staff: [{ name: 'Sara Yilmaz', email: 'owner@aroma.test', role: 'owner', password: 'Owner123!' }],
    tables: 6,
    categories: [
      {
        name: 'Coffee',
        icon: '☕',
        items: [
          { name: 'Flat White', price: 4.2, prep: 4, calories: 120, description: 'Double ristretto, silky microfoam.',
            groups: [
              { name: 'Milk', min: 1, max: 1, options: [
                { name: 'Whole', delta: 0 }, { name: 'Oat', delta: 0.6 }, { name: 'Almond', delta: 0.6 },
              ] },
            ] },
          { name: 'Filter Brew', price: 3.6, prep: 4, calories: 5, description: 'Rotating single origin, V60.' },
          { name: 'Iced Latte', price: 4.6, prep: 4, calories: 160, description: 'Espresso over cold milk and ice.' },
        ],
      },
      {
        name: 'Brunch',
        icon: '🥑',
        items: [
          { name: 'Avocado Toast', price: 9.5, prep: 10, tags: ['vegetarian'], featured: true, calories: 480,
            description: 'Smashed avocado, chilli, lemon, poached egg on sourdough.' },
          { name: 'Shakshuka', price: 11.0, prep: 15, tags: ['vegetarian', 'spicy'], calories: 560,
            description: 'Eggs baked in spiced tomato and pepper sauce.' },
          { name: 'Granola Bowl', price: 8.0, prep: 5, tags: ['vegetarian'], calories: 390,
            description: 'House granola, yoghurt, seasonal fruit and honey.' },
        ],
      },
    ],
  },
];

function wipe() {
  const tables = [
    'audit_logs', 'reviews', 'service_requests', 'order_events', 'order_items', 'orders',
    'options', 'option_groups', 'menu_items', 'categories', 'tables', 'users', 'restaurants',
  ];
  db.pragma('foreign_keys = OFF');
  for (const t of tables) db.prepare(`DELETE FROM ${t}`).run();
  db.prepare("DELETE FROM sqlite_sequence WHERE name IN (" + tables.map(() => '?').join(',') + ')').run(...tables);
  db.pragma('foreign_keys = ON');
}

function seedRestaurant(spec) {
  const r = spec.restaurant;
  const restaurantId = db
    .prepare(
      `INSERT INTO restaurants (name, slug, description, cuisine, phone, email, address, currency,
                                tax_rate, service_charge_rate, primary_color, status, plan, opening_hours)
       VALUES (@name, @slug, @description, @cuisine, @phone, @email, @address, @currency,
               @tax_rate, @service_charge_rate, @primary_color, @status, @plan, @opening_hours)`
    )
    .run({ status: 'active', ...r }).lastInsertRowid;

  const insertUser = db.prepare(
    `INSERT INTO users (restaurant_id, name, email, password_hash, role, status)
     VALUES (?, ?, ?, ?, ?, 'active')`
  );
  for (const s of spec.staff) {
    insertUser.run(restaurantId, s.name, s.email, hashPassword(s.password), s.role);
  }

  const insertTable = db.prepare(
    'INSERT INTO tables (restaurant_id, label, code, seats, zone) VALUES (?, ?, ?, ?, ?)'
  );
  const tableIds = [];
  for (let i = 1; i <= spec.tables; i += 1) {
    let code;
    do {
      code = randomCode(5);
    } while (db.prepare('SELECT 1 FROM tables WHERE restaurant_id = ? AND code = ?').get(restaurantId, code));
    const zone = i > spec.tables - 3 ? 'Terrace' : 'Main';
    tableIds.push(insertTable.run(restaurantId, `Table ${i}`, code, between(2, 6), zone).lastInsertRowid);
  }

  const insertCategory = db.prepare(
    'INSERT INTO categories (restaurant_id, name, description, icon, sort_order) VALUES (?, ?, ?, ?, ?)'
  );
  const insertItem = db.prepare(
    `INSERT INTO menu_items (restaurant_id, category_id, name, description, price, is_available,
                             is_featured, prep_minutes, calories, tags, sort_order)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`
  );
  const insertGroup = db.prepare(
    'INSERT INTO option_groups (item_id, name, min_select, max_select, sort_order) VALUES (?, ?, ?, ?, ?)'
  );
  const insertOption = db.prepare(
    'INSERT INTO options (group_id, name, price_delta, sort_order) VALUES (?, ?, ?, ?)'
  );

  const itemIds = [];
  spec.categories.forEach((cat, catIndex) => {
    const categoryId = insertCategory.run(
      restaurantId, cat.name, cat.description || '', cat.icon || '', catIndex
    ).lastInsertRowid;

    cat.items.forEach((item, itemIndex) => {
      const itemId = insertItem.run(
        restaurantId,
        categoryId,
        item.name,
        item.description || '',
        item.price,
        item.featured ? 1 : 0,
        item.prep || 10,
        item.calories ?? null,
        JSON.stringify(item.tags || []),
        itemIndex
      ).lastInsertRowid;
      itemIds.push({ id: itemId, price: item.price, name: item.name });

      (item.groups || []).forEach((group, groupIndex) => {
        const groupId = insertGroup.run(itemId, group.name, group.min, group.max, groupIndex).lastInsertRowid;
        group.options.forEach((opt, optIndex) => insertOption.run(groupId, opt.name, opt.delta, optIndex));
      });
    });
  });

  return { restaurantId, tableIds, itemIds, restaurant: { ...r, id: restaurantId } };
}

/** Generate believable historical orders so the reports pages are not empty. */
function seedOrders(ctx, spec) {
  const { restaurantId, tableIds, itemIds } = ctx;
  const taxRate = spec.restaurant.tax_rate;
  const serviceRate = spec.restaurant.service_charge_rate;

  const insertOrder = db.prepare(
    `INSERT INTO orders (restaurant_id, table_id, code, status, type, customer_name, note,
                         subtotal, tax, service_charge, total, payment_status, payment_method,
                         session_id, placed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, 'seed-session', ?, ?)`
  );
  const insertLine = db.prepare(
    `INSERT INTO order_items (order_id, item_id, name_snapshot, unit_price, qty, options_snapshot, note, line_total)
     VALUES (?, ?, ?, ?, ?, '[]', '', ?)`
  );
  const insertEvent = db.prepare(
    "INSERT INTO order_events (order_id, status, note, created_at) VALUES (?, ?, ?, ?)"
  );
  const insertReview = db.prepare(
    'INSERT INTO reviews (restaurant_id, order_id, rating, comment, created_at) VALUES (?, ?, ?, ?, ?)'
  );

  const names = ['Ahmed', 'Sofia', 'Daniel', 'Mei', 'Yusuf', 'Elena', 'Tom', 'Priya', 'Jonas', 'Amira', ''];
  const comments = [
    'Food arrived fast and hot. Ordering from the QR code was easy.',
    'Great flavours, will come back.',
    'Service was a little slow but the food made up for it.',
    'Loved being able to order without waiting for a waiter.',
    '',
  ];

  for (let daysAgo = 29; daysAgo >= 0; daysAgo -= 1) {
    // Weekends are busier; today only gets a partial day of traffic.
    const isWeekend = daysAgo % 7 === 0 || daysAgo % 7 === 6;
    const volume = daysAgo === 0 ? between(3, 7) : between(isWeekend ? 8 : 4, isWeekend ? 18 : 11);

    for (let n = 0; n < volume; n += 1) {
      // Timestamps are written in UTC because SQLite's datetime('now') is UTC.
      let placedAt;
      if (daysAgo === 0) {
        // Today's tickets are spread over the last few hours. They must sit in
        // the past, or the kitchen board would show orders from the future with
        // a nonsensical age.
        placedAt = new Date(Date.now() - between(2, 210) * 60000)
          .toISOString().slice(0, 19).replace('T', ' ');
      } else {
        const hour = pick([12, 12, 13, 13, 14, 18, 19, 19, 20, 20, 21]);
        placedAt = `${new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10)} ` +
          `${String(hour).padStart(2, '0')}:${String(between(0, 59)).padStart(2, '0')}:00`;
      }

      const lineCount = between(1, 4);
      const lines = [];
      let subtotal = 0;
      for (let l = 0; l < lineCount; l += 1) {
        const item = pick(itemIds);
        const qty = between(1, 3);
        const lineTotal = money(item.price * qty);
        subtotal = money(subtotal + lineTotal);
        lines.push({ ...item, qty, lineTotal });
      }

      const serviceCharge = money(subtotal * serviceRate);
      const tax = money((subtotal + serviceCharge) * taxRate);
      const total = money(subtotal + serviceCharge + tax);

      let status;
      if (daysAgo === 0) {
        status = pick(['pending', 'accepted', 'preparing', 'ready', 'served', 'completed', 'completed']);
      } else {
        status = rand() < 0.06 ? 'cancelled' : 'completed';
      }

      let code;
      do {
        code = randomCode(6);
      } while (db.prepare('SELECT 1 FROM orders WHERE code = ?').get(code));

      const paid = status === 'completed';
      const orderId = insertOrder.run(
        restaurantId,
        rand() < 0.12 ? null : pick(tableIds),
        code,
        status,
        rand() < 0.12 ? 'takeaway' : 'dine_in',
        pick(names),
        subtotal,
        tax,
        serviceCharge,
        total,
        paid ? 'paid' : 'unpaid',
        pick(['cash', 'card', 'card', 'online']),
        placedAt,
        placedAt
      ).lastInsertRowid;

      for (const line of lines) {
        insertLine.run(orderId, line.id, line.name, line.price, line.qty, line.lineTotal);
      }
      insertEvent.run(orderId, 'pending', 'Order placed by guest', placedAt);
      if (status !== 'pending') insertEvent.run(orderId, status, 'Seeded history', placedAt);

      if (status === 'completed' && rand() < 0.28) {
        insertReview.run(restaurantId, orderId, between(3, 5), pick(comments), placedAt);
      }
    }
  }

  // A couple of open service requests so the staff screens have live work.
  const openTables = tableIds.slice(0, 2);
  const insertRequest = db.prepare(
    'INSERT INTO service_requests (restaurant_id, table_id, type, note) VALUES (?, ?, ?, ?)'
  );
  insertRequest.run(restaurantId, openTables[0], 'waiter', 'Guest needs help with the menu');
  if (openTables[1]) insertRequest.run(restaurantId, openTables[1], 'bill', '');

  // Any table with a live order should read as occupied.
  db.prepare(
    `UPDATE tables SET status = 'occupied'
      WHERE restaurant_id = ? AND id IN (
        SELECT DISTINCT table_id FROM orders
         WHERE restaurant_id = ? AND status NOT IN ('completed','cancelled') AND table_id IS NOT NULL)`
  ).run(restaurantId, restaurantId);
}

function main() {
  migrate();

  const existing = db.prepare('SELECT COUNT(*) AS n FROM restaurants').get().n;
  if (existing > 0 && !RESET) {
    console.log(`[seed] Database already has ${existing} restaurant(s). Run "npm run reset" to rebuild it.`);
    return;
  }
  if (RESET) {
    console.log('[seed] Wiping existing data…');
    wipe();
  }

  db.transaction(() => {
    db.prepare(
      `INSERT INTO users (restaurant_id, name, email, password_hash, role, status)
       VALUES (NULL, 'Platform Admin', 'admin@menu.app', ?, 'super_admin', 'active')`
    ).run(hashPassword('Admin123!'));

    for (const spec of DEMO) {
      const ctx = seedRestaurant(spec);
      if (spec.restaurant.status !== 'pending') seedOrders(ctx, spec);
      console.log(`[seed] ${spec.restaurant.name} → /r/${spec.restaurant.slug}`);
    }
  })();

  const sample = db
    .prepare(
      `SELECT r.slug, t.code FROM tables t JOIN restaurants r ON r.id = t.restaurant_id
        WHERE r.slug = 'zaytoun-grill' ORDER BY t.id LIMIT 1`
    )
    .get();

  console.log(`
[seed] Done. Sign-in accounts:

  Platform admin      admin@menu.app        Admin123!
  Restaurant owner    owner@zaytoun.test    Owner123!
  Restaurant manager  manager@zaytoun.test  Manager123!
  Waiter              waiter@zaytoun.test   Waiter123!
  Kitchen             kitchen@zaytoun.test  Kitchen123!
  Second restaurant   owner@bella.test      Owner123!

  Guest table link    /t/${sample.slug}/${sample.code}
`);
}

main();
