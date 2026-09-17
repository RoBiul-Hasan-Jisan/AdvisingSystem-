const mongoose = require('mongoose');

/**
 * Key-value settings store. Right now the only key used is "currentTerm" -
 * this is what lets the frontend stop hardcoding a term string: it asks
 * GET /api/terms/current once and every page derives from that, so rolling
 * over to a new term (every ~4 months, per the original requirement) is an
 * admin action, not a code change and redeploy.
 */
const configSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: String, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Config', configSchema);
