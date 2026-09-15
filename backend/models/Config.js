const mongoose = require('mongoose');

// Small singleton-style settings store. Currently only holds "currentTerm"
// (e.g. "Fall 2026") so the rest of the app knows which term's sections to
// show without every route needing a term param.
const configSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model('Config', configSchema);
