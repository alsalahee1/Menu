'use strict';

const crypto = require('crypto');
const { badRequest } = require('./errors');

function str(value, field, { required = false, max = 500, min = 0, fallback = '' } = {}) {
  if (value === undefined || value === null) {
    if (required) throw badRequest(`"${field}" is required`);
    return fallback;
  }
  const s = String(value).trim();
  if (required && s.length === 0) throw badRequest(`"${field}" is required`);
  if (s.length < min) throw badRequest(`"${field}" must be at least ${min} characters`);
  if (s.length > max) throw badRequest(`"${field}" must be at most ${max} characters`);
  return s;
}

function num(value, field, { required = false, min = -Infinity, max = Infinity, fallback = 0 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest(`"${field}" is required`);
    return fallback;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) throw badRequest(`"${field}" must be a number`);
  if (n < min) throw badRequest(`"${field}" must be at least ${min}`);
  if (n > max) throw badRequest(`"${field}" must be at most ${max}`);
  return n;
}

function int(value, field, opts = {}) {
  const n = num(value, field, opts);
  if (!Number.isInteger(n)) throw badRequest(`"${field}" must be a whole number`);
  return n;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const s = String(value).toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function oneOf(value, field, allowed, { required = false, fallback = null } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest(`"${field}" is required`);
    return fallback;
  }
  const s = String(value);
  if (!allowed.includes(s)) {
    throw badRequest(`"${field}" must be one of: ${allowed.join(', ')}`);
  }
  return s;
}

function email(value, field = 'email', { required = true } = {}) {
  const s = str(value, field, { required, max: 200 }).toLowerCase();
  if (!s && !required) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw badRequest(`"${field}" must be a valid email address`);
  return s;
}

/** URL-safe slug used in the public menu address. */
function slugify(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alike characters

/** Short, human-readable, non-sequential code (order tracking, table codes). */
function randomCode(length = 6) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

/** Round to 2 decimals without float drift artefacts like 12.340000000000002. */
function money(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

module.exports = { str, num, int, bool, oneOf, email, slugify, randomCode, money };
