const mongoose = require('mongoose');

/**
 * A "routine" is what the student sees BEFORE picking sections: the list of
 * courses they're expected to take this term.
 *   - type REGULAR: generated straight from CurriculumSlot for
 *     (student.program, student.currentSemester). Rebuilt on demand, not
 *     hand-edited.
 *   - type CUSTOM: a one-off list for a single student who is taking an
 *     extra/retake course alongside (or instead of) their regular slate.
 *     Created by admin (or by the system when a student requests an extra
 *     course and admin approves it).
 */
const routineSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    term: { type: String, required: true },
    type: { type: String, enum: ['REGULAR', 'CUSTOM'], default: 'REGULAR' },
    courseCodes: [{ type: String, uppercase: true }],
    note: { type: String, default: '' }, // e.g. "Retaking CSE 221, advancing HUM 301 early"
    createdBy: { type: String, enum: ['SYSTEM', 'ADMIN'], default: 'SYSTEM' },
  },
  { timestamps: true }
);

routineSchema.index({ student: 1, term: 1 }, { unique: true });

module.exports = mongoose.model('Routine', routineSchema);
