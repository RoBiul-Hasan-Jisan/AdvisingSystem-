const Config = require('../models/Config');
const Semester = require('../models/Semester');

// Resolves the "current term" that routine/section browsing should default
// to. Prefers the explicit admin setting; falls back to whichever term's
// data was imported most recently, so a fresh import "just works" even
// before an admin remembers to flip the switch.
async function getCurrentTerm() {
  const config = await Config.findOne({ key: 'currentTerm' });
  if (config) return config.value;

  const latest = await Semester.findOne().sort('-createdAt');
  return latest ? latest.term : null;
}

module.exports = { getCurrentTerm };
