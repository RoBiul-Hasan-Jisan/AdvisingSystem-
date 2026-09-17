const mongoose = require('mongoose');

/**
 * Records every admin action ("admin can do anything" from the original
 * spec cuts both ways - anything they can do should be traceable). `admin`
 * links to the account; `adminName` is denormalized so the log still reads
 * sensibly if that account is later deleted.
 */
const auditLogSchema = new mongoose.Schema(
  {
    admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    adminName: { type: String, required: true },
    action: { type: String, required: true }, // e.g. "course.create", "promotion.run", "import.confirm"
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
