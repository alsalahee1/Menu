'use strict';

const { db } = require('../db');

// Prepared lazily so requiring this module never depends on the schema
// already existing.
let insert = null;
function statement() {
  if (!insert) {
    insert = db.prepare(`
      INSERT INTO audit_logs (actor_user_id, actor_email, restaurant_id, action, entity, entity_id, meta)
      VALUES (@actor_user_id, @actor_email, @restaurant_id, @action, @entity, @entity_id, @meta)
    `);
  }
  return insert;
}

/** Record an administrative action. Never throws — auditing must not break a request. */
function log(user, action, { restaurantId = null, entity = '', entityId = '', meta = {} } = {}) {
  try {
    statement().run({
      actor_user_id: user ? user.id : null,
      actor_email: user ? user.email : '',
      restaurant_id: restaurantId ?? (user ? user.restaurant_id : null),
      action,
      entity,
      entity_id: String(entityId ?? ''),
      meta: JSON.stringify(meta ?? {}),
    });
  } catch (err) {
    console.error('[audit] failed to write log', err);
  }
}

module.exports = { log };
