const mongoose = require('mongoose');

/**
 * One document per (student, section). enrolledAt is what makes the system
 * first-come-first-served and auditable - it's set once, at insert time.
 */
const enrollmentSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    section: { type: mongoose.Schema.Types.ObjectId, ref: 'Section', required: true },
    courseCode: { type: String, required: true, uppercase: true },
    term: { type: String, required: true },
    status: {
      type: String,
      enum: ['ENROLLED', 'WAITLISTED', 'DROPPED', 'ADMIN_ASSIGNED'],
      default: 'ENROLLED',
    },
    enrolledAt: { type: Date, default: Date.now },
    assignedBy: { type: String, enum: ['STUDENT', 'ADMIN', 'TEACHER'], default: 'STUDENT' },
  },
  { timestamps: true }
);

// A student can only hold one active (ENROLLED/WAITLISTED) record per course per term.
enrollmentSchema.index(
  { student: 1, courseCode: 1, term: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['ENROLLED', 'WAITLISTED'] } } }
);

module.exports = mongoose.model('Enrollment', enrollmentSchema);
