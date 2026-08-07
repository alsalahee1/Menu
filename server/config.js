'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Minimal .env loader so the project stays dependency-light.
function loadEnvFile() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile();

const config = {
  root: ROOT,
  port: Number(process.env.PORT || 3000),
  env: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me',
  jwtTtl: Number(process.env.JWT_TTL || 60 * 60 * 24 * 7),
  databaseFile: path.resolve(ROOT, process.env.DATABASE_FILE || './data/menu.db'),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, ''),
};

if (config.env === 'production' && config.jwtSecret === 'dev-only-insecure-secret-change-me') {
  console.warn('[config] JWT_SECRET is not set. Refusing to run with the development secret in production.');
  process.exit(1);
}

module.exports = config;
