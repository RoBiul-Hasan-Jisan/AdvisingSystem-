const Config = require('../models/Config');
const Section = require('../models/Section');

/**
 * Prefers the explicit admin-set value; falls back to whichever term has the
 * most recently created Section (so a fresh PDF import "just works" even
 * before an admin remembers to flip the switch via PUT /api/terms/current).
 */
async function getCurrentTerm() {
  const config = await Config.findOne({ key: 'currentTerm' });
  if (config) return config.value;

  const latest = await Section.findOne().sort({ createdAt: -1 });
  return latest ? latest.term : null;
}

module.exports = { getCurrentTerm };
