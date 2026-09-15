const mongoose = require('mongoose');

const semesterSchema = new mongoose.Schema({
  number: { type: Number, required: true, unique: true, min: 1, max: 12 },
  courseCodes: [{ type: String, uppercase: true }], // default courses offered in this semester
  term: { type: String, default: '' } // e.g. "Summer 2026" - which real-world term this plan applies to
}, { timestamps: true });

module.exports = mongoose.model('Semester', semesterSchema);
