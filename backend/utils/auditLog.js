const AuditLog = require('../models/AuditLog');

// Deliberately swallows its own errors - a broken audit write should never
// fail the admin action that triggered it. Call this AFTER the real
// mutation succeeds, not before, so the log reflects what actually happened.
async function logAction(adminUser, action, details = {}) {
  try {
    await AuditLog.create({
      admin: adminUser._id,
      adminName: adminUser.name,
      action,
      details
    });
  } catch (err) {
    console.error('Audit log write failed (non-fatal):', err.message);
  }
}

module.exports = { logAction };
