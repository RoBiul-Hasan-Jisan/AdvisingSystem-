const mongoose = require('mongoose');

const enrollmentSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  section: { type: mongoose.Schema.Types.ObjectId, ref: 'Section', required: true },
  courseCode: { type: String, required: true, uppercase: true },
  term: { type: String, required: true },
  isExtraCourse: { type: Boolean, default: false }, // true if outside their default semester plan -> triggers custom routine
  status: { type: String, enum: ['enrolled', 'dropped', 'waitlisted'], default: 'enrolled' },
  enrolledAt: { type: Date, default: Date.now } // used as the queue tiebreaker (first-come-first-served)
}, { timestamps: true });

// a student can't double-enroll in the same section
enrollmentSchema.index({ student: 1, section: 1 }, { unique: true });

module.exports = mongoose.model('Enrollment', enrollmentSchema);
