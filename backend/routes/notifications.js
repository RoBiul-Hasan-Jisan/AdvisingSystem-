const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');

/**
 * GET /api/notifications
 * Any logged-in user - their own notifications, newest first.
 */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const notifications = await Notification.find({ user: req.user._id }).sort('-createdAt').limit(50);
  const unreadCount = await Notification.countDocuments({ user: req.user._id, read: false });
  res.json({ notifications, unreadCount });
}));

/**
 * POST /api/notifications/:id/read
 * Marks one notification read.
 */
router.post('/:id/read', requireAuth, asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    { read: true },
    { new: true }
  );
  if (!notification) return res.status(404).json({ error: 'Notification not found' });
  res.json(notification);
}));

/**
 * POST /api/notifications/read-all
 * Marks everything read (e.g. "clear all" button).
 */
router.post('/read-all', requireAuth, asyncHandler(async (req, res) => {
  await Notification.updateMany({ user: req.user._id, read: false }, { read: true });
  res.json({ message: 'All notifications marked read' });
}));

module.exports = router;
