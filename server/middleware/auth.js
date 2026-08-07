'use strict';

const { db } = require('../db');
const jwt = require('../lib/jwt');
const { unauthorized, forbidden } = require('../lib/errors');

const ROLES = ['super_admin', 'owner', 'manager', 'waiter', 'kitchen'];

/** Roles that may administer a restaurant's configuration (menu, staff, settings). */
const RESTAURANT_ADMIN_ROLES = ['owner', 'manager'];
/** Roles allowed to move orders through the kitchen/service flow. */
const RESTAURANT_STAFF_ROLES = ['owner', 'manager', 'waiter', 'kitchen'];

function readToken(req) {
  const header = req.get('authorization') || '';
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  if (req.query && typeof req.query.token === 'string') return req.query.token; // EventSource cannot set headers
  return null;
}

/**
 * Populates req.user when a valid token is present. Does not reject.
 * Always re-reads the user row so a disabled account loses access immediately.
 */
function attachUser(req, _res, next) {
  const token = readToken(req);
  if (!token) return next();

  const payload = jwt.verify(token);
  if (!payload) return next();

  const user = db
    .prepare('SELECT id, restaurant_id, name, email, role, status FROM users WHERE id = ?')
    .get(payload.sub);
  if (!user || user.status !== 'active') return next();

  req.user = user;
  return next();
}

function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  return next();
}

function requireRole(...roles) {
  const allowed = roles.flat();
  return function roleGuard(req, _res, next) {
    if (!req.user) return next(unauthorized());
    if (!allowed.includes(req.user.role)) {
      return next(forbidden(`This action requires one of: ${allowed.join(', ')}`));
    }
    return next();
  };
}

/**
 * Resolves req.restaurantId for the /api/rest/* routes.
 *
 * Restaurant staff are locked to their own tenant. A platform super_admin may
 * inspect any tenant by sending an X-Restaurant-Id header, which is what the
 * admin console's "open dashboard" action uses.
 */
function requireRestaurantScope(req, _res, next) {
  if (!req.user) return next(unauthorized());

  if (req.user.role === 'super_admin') {
    const header = req.get('x-restaurant-id') || req.query.restaurant_id;
    const id = Number(header);
    if (!Number.isInteger(id) || id <= 0) {
      return next(forbidden('Platform admins must specify a restaurant via the X-Restaurant-Id header'));
    }
    const exists = db.prepare('SELECT id FROM restaurants WHERE id = ?').get(id);
    if (!exists) return next(forbidden('Unknown restaurant'));
    req.restaurantId = id;
    return next();
  }

  if (!req.user.restaurant_id) return next(forbidden('Your account is not linked to a restaurant'));

  const restaurant = db
    .prepare('SELECT id, status FROM restaurants WHERE id = ?')
    .get(req.user.restaurant_id);
  if (!restaurant) return next(forbidden('Your restaurant no longer exists'));
  if (restaurant.status === 'suspended') {
    return next(forbidden('This restaurant account is suspended. Contact the platform administrator.'));
  }

  req.restaurantId = restaurant.id;
  return next();
}

module.exports = {
  ROLES,
  RESTAURANT_ADMIN_ROLES,
  RESTAURANT_STAFF_ROLES,
  attachUser,
  requireAuth,
  requireRole,
  requireRestaurantScope,
};
