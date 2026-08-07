'use strict';

const express = require('express');
const { db } = require('../db');
const jwt = require('../lib/jwt');
const { verifyPassword, hashPassword } = require('../lib/password');
const { str, email } = require('../lib/validate');
const { unauthorized, badRequest } = require('../lib/errors');
const { requireAuth } = require('../middleware/auth');
const audit = require('../lib/audit');

const router = express.Router();

/**
 * Landing page each role should be sent to after signing in.
 * This must point at a page the role can actually open, otherwise the client
 * guard bounces the user straight back here.
 */
function homeForRole(role) {
  if (role === 'super_admin') return '/admin/';
  if (role === 'kitchen') return '/dashboard/kitchen.html';
  if (role === 'waiter') return '/dashboard/orders.html';
  return '/dashboard/';
}

function publicUser(user, restaurant) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    restaurant_id: user.restaurant_id,
    restaurant: restaurant
      ? { id: restaurant.id, name: restaurant.name, slug: restaurant.slug, currency: restaurant.currency, status: restaurant.status }
      : null,
    home: homeForRole(user.role),
  };
}

router.post('/login', (req, res, next) => {
  try {
    const addr = email(req.body.email);
    const password = str(req.body.password, 'password', { required: true, max: 200 });

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(addr);

    // Same message and roughly the same work for both failure modes.
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw unauthorized('Incorrect email or password');
    }
    if (user.status !== 'active') throw unauthorized('This account has been disabled');

    const restaurant = user.restaurant_id
      ? db.prepare('SELECT id, name, slug, currency, status FROM restaurants WHERE id = ?').get(user.restaurant_id)
      : null;

    if (restaurant && restaurant.status === 'suspended') {
      throw unauthorized('This restaurant account is suspended. Contact the platform administrator.');
    }

    db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);
    audit.log(user, 'auth.login', { restaurantId: user.restaurant_id, entity: 'user', entityId: user.id });

    const token = jwt.sign({ sub: user.id, role: user.role, rid: user.restaurant_id });
    res.json({ token, user: publicUser(user, restaurant) });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, (req, res) => {
  const restaurant = req.user.restaurant_id
    ? db.prepare('SELECT id, name, slug, currency, status FROM restaurants WHERE id = ?').get(req.user.restaurant_id)
    : null;
  res.json({ user: publicUser(req.user, restaurant) });
});

router.post('/change-password', requireAuth, (req, res, next) => {
  try {
    const currentPassword = str(req.body.current_password, 'current_password', { required: true, max: 200 });
    const newPassword = str(req.body.new_password, 'new_password', { required: true, min: 8, max: 200 });

    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(currentPassword, row.password_hash)) {
      throw badRequest('Your current password is not correct');
    }

    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), req.user.id);
    audit.log(req.user, 'auth.password_changed', { entity: 'user', entityId: req.user.id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
