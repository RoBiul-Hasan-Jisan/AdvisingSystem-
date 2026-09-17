const mongoose = require('mongoose');

/**
 * One row per (program, term). Controls when students are allowed to enroll
 * and how many credits they can carry - the two guardrails that turn
 * "first come first served" from a slogan into something actually enforced.
 */
const termSchema = new mongoose.Schema(
  {
    term: { type: String, required: true, trim: true }, // "Summer 2026"
    program: { type: String, required: true, enum: ['CSE', 'EEE', 'ETE'] },
    enrollmentStart: { type: Date, required: true },
    enrollmentEnd: { type: Date, required: true },
    creditLimit: { type: Number, default: 18 }, // max credits a student can hold this term
  },
  { timestamps: true }
);

termSchema.index({ term: 1, program: 1 }, { unique: true });

module.exports = mongoose.model('Term', termSchema);
