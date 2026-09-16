const mongoose = require('mongoose');

// In-app notifications only. Wiring real email/SMS would need a provider
// (SendGrid, Twilio, etc.) and credentials this environment doesn't have -
// this is the piece that's ready to plug a provider into later: create a
// notification here AND send an email in the same call, once you have one.
const notificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  message: { type: String, required: true },
  read: { type: Boolean, default: false }
}, { timestamps: true });

notificationSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
