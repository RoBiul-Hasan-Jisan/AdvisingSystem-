const express = require('express');
const AuditLog = require('../models/AuditLog');
const { requireAuth, requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

// GET /api/audit-log?action=&limit=50
router.get(
  '/',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { action } = req.query;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const filter = {};
    if (action) filter.action = action;
    const entries = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(limit);
    res.json(entries);
  })
);

module.exports = router;
