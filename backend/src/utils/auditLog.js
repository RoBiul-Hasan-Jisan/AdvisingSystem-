const AuditLog = require('../models/AuditLog');

/**
 * Fire-and-forget audit write. Never throws into the caller - a logging
 * failure should not fail the admin action it's describing, so errors here
 * are swallowed with a console warning rather than propagated.
 */
async function logAction(adminUser, action, details = {}) {
  try {
    await AuditLog.create({ admin: adminUser._id, adminName: adminUser.name, action, details });
  } catch (err) {
    console.warn('[audit] failed to record action', action, err.message);
  }
}

module.exports = { logAction };
