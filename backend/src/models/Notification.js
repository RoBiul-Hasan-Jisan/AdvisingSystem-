const mongoose = require('mongoose');

/**
 * In-app notifications - deliberately not email, since this project has no
 * SMTP/mail provider configured. A student polls GET /api/notifications/me
 * (or the frontend could add a badge that refetches periodically); this is
 * the same information an email would carry, just delivered in-app. Swapping
 * in real email later just means adding a send step alongside `create()`
 * calls, not restructuring anything.
 */
const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: ['WAITLIST_PROMOTED', 'REQUEST_APPROVED', 'REQUEST_REJECTED', 'GENERAL'],
      default: 'GENERAL',
    },
    message: { type: String, required: true },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
