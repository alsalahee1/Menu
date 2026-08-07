'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const config = require('../config');
const { badRequest } = require('../lib/errors');
const { rateLimit } = require('../middleware/rateLimit');
const {
  requireAuth, requireRole, requireRestaurantScope, RESTAURANT_ADMIN_ROLES,
} = require('../middleware/auth');

const router = express.Router();

fs.mkdirSync(config.uploadDir, { recursive: true });

/**
 * Accepted image types, keyed by extension, each with the magic bytes that
 * must appear at the start of the file.
 *
 * The declared Content-Type is a hint from the client, so it is never trusted
 * on its own — the signature decides what actually gets written to disk.
 */
const SIGNATURES = [
  { ext: 'png', mime: 'image/png', test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'gif', mime: 'image/gif', test: (b) => b.length > 6 && (b.subarray(0, 6).toString('latin1') === 'GIF87a' || b.subarray(0, 6).toString('latin1') === 'GIF89a') },
  {
    ext: 'webp',
    mime: 'image/webp',
    test: (b) => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];

function detect(buffer) {
  return SIGNATURES.find((signature) => signature.test(buffer)) || null;
}

/**
 * Upload a dish image.
 *
 * The body is the raw image, not multipart — that avoids a parser dependency
 * and keeps the client a single fetch with the File as the body.
 */
router.post(
  '/image',
  requireAuth,
  requireRole('super_admin', ...RESTAURANT_ADMIN_ROLES),
  requireRestaurantScope,
  rateLimit({ name: 'upload', windowMs: 60_000, max: 20, message: 'Too many uploads — please wait a minute.' }),
  express.raw({
    type: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/octet-stream'],
    limit: config.maxUploadBytes,
  }),
  (req, res, next) => {
    try {
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        throw badRequest('Send the image file as the raw request body.');
      }

      const signature = detect(body);
      if (!signature) {
        throw badRequest('That file is not a PNG, JPEG, GIF or WebP image.');
      }

      // Content-addressed: re-uploading the same picture reuses the same file.
      const hash = crypto.createHash('sha256').update(body).digest('hex').slice(0, 32);
      const filename = `${req.restaurantId}-${hash}.${signature.ext}`;
      const target = path.join(config.uploadDir, filename);

      if (!fs.existsSync(target)) fs.writeFileSync(target, body);

      res.status(201).json({
        url: `/uploads/${filename}`,
        bytes: body.length,
        type: signature.mime,
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
