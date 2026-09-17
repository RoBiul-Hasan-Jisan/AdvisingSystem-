const express = require('express');
const Notification = require('../models/Notification');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

// GET /api/notifications/me - newest first, unread first within that
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await Notification.find({ user: req.dbUser._id }).sort({ read: 1, createdAt: -1 }).limit(50);
    res.json(rows);
  })
);

// POST /api/notifications/:id/read
router.post(
  '/:id/read',
  requireAuth,
  asyncHandler(async (req, res) => {
    const note = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.dbUser._id },
      { read: true },
      { new: true }
    );
    if (!note) return res.status(404).json({ error: 'Notification not found' });
    res.json(note);
  })
);

// POST /api/notifications/read-all
router.post(
  '/read-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    await Notification.updateMany({ user: req.dbUser._id, read: false }, { read: true });
    res.json({ ok: true });
  })
);

module.exports = router;
