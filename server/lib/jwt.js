'use strict';

const crypto = require('crypto');
const config = require('../config');

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function fromBase64url(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function sign(payload, ttlSeconds = config.jwtTtl) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSeconds };

  const encoded =
    `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(body))}`;
  const signature = base64url(
    crypto.createHmac('sha256', config.jwtSecret).update(encoded).digest()
  );
  return `${encoded}.${signature}`;
}

/** Returns the decoded payload, or null when the token is invalid or expired. */
function verify(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const encoded = `${parts[0]}.${parts[1]}`;
  const expected = crypto.createHmac('sha256', config.jwtSecret).update(encoded).digest();
  const actual = fromBase64url(parts[2]);
  if (actual.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(actual, expected)) return null;

  let payload;
  try {
    payload = JSON.parse(fromBase64url(parts[1]).toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

module.exports = { sign, verify };
