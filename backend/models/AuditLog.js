const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  adminName: { type: String, required: true }, // denormalized so the log still reads fine if the admin account is later deleted
  action: { type: String, required: true }, // e.g. "course.create", "promotion.run"
  details: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
