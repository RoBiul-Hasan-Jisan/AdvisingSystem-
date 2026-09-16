const express = require('express');
const router = express.Router();
const AuditLog = require('../models/AuditLog');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');

/**
 * GET /api/audit-log?page=1&limit=50
 * Admin only - paginated, most recent first.
 */
router.get('/', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Number(req.query.limit) || 50);

  const [entries, total] = await Promise.all([
    AuditLog.find().sort('-createdAt').skip((page - 1) * limit).limit(limit),
    AuditLog.countDocuments()
  ]);

  res.json({ entries, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
}));

module.exports = router;
