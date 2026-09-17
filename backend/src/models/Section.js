const mongoose = require('mongoose');

const scheduleEntrySchema = new mongoose.Schema(
  {
    day: {
      type: String,
      enum: ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'],
      required: true,
    },
    startTime: { type: String, required: true }, // "10:00" 24h
    endTime: { type: String, required: true },
    room: { type: String, required: true },
  },
  { _id: false }
);

/**
 * A concrete, seat-limited offering of a course in a given term.
 * courseCode + sectionNumber + term must be unique (e.g. "CSE 221" / "2" / "Summer 2026").
 *
 * Seat handling: `capacity` and `enrolledCount` live on the same document so
 * enrollment can be done with a single atomic findOneAndUpdate
 * (condition: enrolledCount < capacity) -> no two students can grab the
 * last seat at once. See routes/enrollment.js.
 */
const sectionSchema = new mongoose.Schema(
  {
    courseCode: { type: String, required: true, uppercase: true, trim: true },
    sectionNumber: { type: String, required: true, trim: true }, // "1", "2", "N601" style label ok too
    term: { type: String, required: true, trim: true }, // "Summer 2026"
    program: { type: String, enum: ['CSE', 'EEE', 'ETE', 'ANY'], default: 'ANY' },
    capacity: { type: Number, required: true },
    enrolledCount: { type: Number, default: 0 },
    faculty: { type: String, trim: true, default: '' },
    schedule: [scheduleEntrySchema],
    waitlist: [
      {
        student: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        queuedAt: { type: Date, default: Date.now },
      },
    ],
    isOpen: { type: Boolean, default: true }, // admin/teacher can force-close a section
  },
  { timestamps: true }
);

sectionSchema.index({ courseCode: 1, sectionNumber: 1, term: 1 }, { unique: true });
sectionSchema.virtual('seatsLeft').get(function () {
  return Math.max(this.capacity - this.enrolledCount, 0);
});
sectionSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Section', sectionSchema);
