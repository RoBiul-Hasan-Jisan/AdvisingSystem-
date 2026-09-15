const mongoose = require('mongoose');

const semesterSchema = new mongoose.Schema({
  number: { type: Number, required: true, min: 1, max: 12 },
  courseCodes: [{ type: String, uppercase: true }], // courses offered in this semester slot
  term: { type: String, required: true } // e.g. "Fall 2026" - each ~4-month term gets its own plan
}, { timestamps: true });

// A given semester number (1-12) has one course plan per term, not one globally -
// this is what makes re-importing a new term's PDF safe without clobbering the last one.
semesterSchema.index({ number: 1, term: 1 }, { unique: true });

module.exports = mongoose.model('Semester', semesterSchema);
