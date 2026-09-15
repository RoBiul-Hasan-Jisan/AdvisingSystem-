const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  firebaseUid: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  role: { type: String, enum: ['admin', 'teacher', 'student'], required: true },

  // student-only fields
  studentId: { type: String, unique: true, sparse: true },
  currentSemester: { type: Number, default: 1, min: 1, max: 12 },
  completedCourses: [{
    courseCode: { type: String, uppercase: true },
    grade: String,
    status: { type: String, enum: ['pass', 'fail', 'ongoing'], default: 'ongoing' },
    term: String
  }],
  hasCustomRoutine: { type: Boolean, default: false } // true once they diverge from the default semester plan
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
