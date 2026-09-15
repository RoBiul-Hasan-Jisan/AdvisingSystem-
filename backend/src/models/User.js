const mongoose = require('mongoose');

const passedCourseSchema = new mongoose.Schema(
  {
    courseCode: { type: String, uppercase: true, required: true },
    grade: { type: String, required: true }, // "A", "B+", "F", etc.
    term: { type: String, required: true },
    passed: { type: Boolean, required: true },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    firebaseUid: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    role: { type: String, enum: ['student', 'teacher', 'admin'], default: 'student' },

    // --- student-only fields ---
    studentId: { type: String, unique: true, sparse: true },
    program: { type: String, enum: ['CSE', 'EEE', 'ETE'], required: function () { return this.role === 'student'; } },
    currentSemester: { type: Number, min: 1, max: 12, default: 1 },
    status: {
      type: String,
      enum: ['ACTIVE', 'PROBATION', 'ON_LEAVE', 'GRADUATED', 'SUSPENDED'],
      default: 'ACTIVE',
    },
    courseHistory: [passedCourseSchema],

    // --- teacher-only fields ---
    teacherShortCode: { type: String }, // e.g. "MHN" to match section.faculty labels
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
