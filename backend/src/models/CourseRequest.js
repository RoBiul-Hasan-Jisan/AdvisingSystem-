const mongoose = require('mongoose');

/**
 * A student-initiated request to take a course outside their regular
 * semester slate (retaking a failed course, advancing one early, etc).
 * Admin reviews and either approves (which folds it into a CUSTOM Routine
 * via /api/routines/custom) or rejects it with a note - this is the
 * student-facing front door to that endpoint, instead of admin having to
 * build custom routines from scratch with no visibility into who wants what.
 */
const courseRequestSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    term: { type: String, required: true },
    courseCode: { type: String, required: true, uppercase: true, trim: true },
    reason: { type: String, default: '' },
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
    reviewNote: { type: String, default: '' },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CourseRequest', courseRequestSchema);
