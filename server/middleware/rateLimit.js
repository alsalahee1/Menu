'use strict';

const { HttpError } = require('../lib/errors');

/**
 * Fixed-window rate limiting, held in memory.
 *
 * The public ordering endpoints have no user account behind them, so IP is the
 * only identity available. That makes this a blunt instrument — it exists to
 * stop a script hammering the order endpoint, not to defeat a determined
 * attacker. A shared limiter (Redis) is the right move once more than one
 * process serves traffic; see the README.
 */

const buckets = new Map();

// A single sweep keeps the map from growing without bound on a long-lived
// process. unref() so the timer never holds the event loop open.
const SWEEP_MS = 60_000;
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
}, SWEEP_MS);
if (typeof sweeper.unref === 'function') sweeper.unref();

/** Prefer the proxy-provided client IP; Express resolves this via `trust proxy`. */
function clientIp(req) {
  return req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
}

/**
 * @param {object} options
 *   name     bucket namespace, so limits do not bleed between routes
 *   windowMs window length
 *   max      requests allowed per window
 *   key      optional custom identity function (defaults to client IP)
 *   message  response text when the limit trips
 */
function rateLimit(options) {
  const { name, windowMs, max, key, message } = options;

  return function limiter(req, res, next) {
    const identity = `${name}:${key ? key(req) : clientIp(req)}`;
    const now = Date.now();

    let entry = buckets.get(identity);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      buckets.set(identity, entry);
    }
    entry.count += 1;

    const remaining = Math.max(0, max - entry.count);
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil((entry.resetAt - now) / 1000)));

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return next(new HttpError(429, message || 'Too many requests — please wait a moment and try again.'));
    }
    return next();
  };
}

/** Clear all counters. Used by the test suite between cases. */
function reset() {
  buckets.clear();
}

module.exports = { rateLimit, reset, clientIp };
