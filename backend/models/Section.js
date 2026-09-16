const mongoose = require('mongoose');

const sectionSchema = new mongoose.Schema({
  courseCode: { type: String, required: true, uppercase: true },
  sectionLabel: { type: String, required: true }, // e.g. "1", "2", "5" (as in CSE 113.1, CSE 113.2)
  semesterNumber: { type: Number, required: true },
  term: { type: String, required: true }, // e.g. "Summer 2026" - a course can repeat across terms
  capacity: { type: Number, required: true },
  seatsTaken: { type: Number, default: 0 },
  teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  schedule: [{
    day: String,        // "Saturday", "Sunday", ...
    startTime: String,  // "10.00"
    endTime: String,    // "11.30"
    room: String
  }]
}, { timestamps: true });

// One label per course per semester per term
sectionSchema.index({ courseCode: 1, sectionLabel: 1, semesterNumber: 1, term: 1 }, { unique: true });

// --- Indexes added after reviewing actual query patterns ---
// routine page: Section.find({ courseCode: {$in}, semesterNumber, term })
sectionSchema.index({ term: 1, semesterNumber: 1 });
// catalog page: Section.find({ term }) then grouped by courseCode in app code
sectionSchema.index({ term: 1, courseCode: 1 });
// teacher's "my sections" filter (?teacher=me)
sectionSchema.index({ teacher: 1 });

sectionSchema.virtual('seatsAvailable').get(function () {
  return this.capacity - this.seatsTaken;
});
sectionSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Section', sectionSchema);
