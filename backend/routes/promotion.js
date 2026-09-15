const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { requireAuth, requireRole } = require('../middleware/auth');

/**
 * POST /api/promotion/result
 * body: { studentId, courseCode, grade, status: 'pass'|'fail', term }
 * Admin records one course result for one student. Upserts into
 * completedCourses (so re-uploading a corrected grade just overwrites it).
 */
router.post('/result', requireAuth, requireRole('admin'), async (req, res) => {
  const { studentId, courseCode, grade, status, term } = req.body;
  const student = await User.findById(studentId);
  if (!student || student.role !== 'student') return res.status(404).json({ error: 'Student not found' });

  const existing = student.completedCourses.find(c => c.courseCode === courseCode.toUpperCase() && c.term === term);
  if (existing) {
    existing.grade = grade;
    existing.status = status;
  } else {
    student.completedCourses.push({ courseCode: courseCode.toUpperCase(), grade, status, term });
  }
  await student.save();
  res.json({ message: 'Result recorded', student });
});

/**
 * POST /api/promotion/bulk
 * body: { results: [{ studentId, courseCode, grade, status, term }, ...] }
 * Bulk-load a whole semester's result sheet in one call.
 */
router.post('/bulk', requireAuth, requireRole('admin'), async (req, res) => {
  const { results } = req.body;
  const summary = { updated: 0, errors: [] };

  for (const r of results) {
    try {
      const student = await User.findById(r.studentId);
      if (!student) { summary.errors.push({ ...r, error: 'Student not found' }); continue; }
      const existing = student.completedCourses.find(c => c.courseCode === r.courseCode.toUpperCase() && c.term === r.term);
      if (existing) {
        existing.grade = r.grade;
        existing.status = r.status;
      } else {
        student.completedCourses.push({ courseCode: r.courseCode.toUpperCase(), grade: r.grade, status: r.status, term: r.term });
      }
      await student.save();
      summary.updated++;
    } catch (err) {
      summary.errors.push({ ...r, error: err.message });
    }
  }
  res.json(summary);
});

/**
 * POST /api/promotion/promote
 * body: { term }  -- e.g. "Summer 2026"
 * Auto-promotes every student who passed EVERY course they were enrolled in
 * for that term. Students with any 'fail' stay on the same semester (they
 * retake next term, which is why extra/retake courses feed the custom-routine
 * logic in the enrollment engine).
 */
router.post('/promote', requireAuth, requireRole('admin'), async (req, res) => {
  const { term } = req.body;
  const students = await User.find({ role: 'student' });

  const promoted = [];
  const held = [];

  for (const student of students) {
    const thisTermResults = student.completedCourses.filter(c => c.term === term);
    if (thisTermResults.length === 0) continue; // no results this term, skip

    const anyFail = thisTermResults.some(c => c.status === 'fail');
    if (!anyFail && student.currentSemester < 12) {
      student.currentSemester += 1;
      student.hasCustomRoutine = false; // fresh semester -> back to default routine until they add extras
      await student.save();
      promoted.push({ studentId: student._id, name: student.name, newSemester: student.currentSemester });
    } else {
      held.push({ studentId: student._id, name: student.name, currentSemester: student.currentSemester, failedCourses: thisTermResults.filter(c => c.status === 'fail').map(c => c.courseCode) });
    }
  }

  res.json({ term, promotedCount: promoted.length, heldCount: held.length, promoted, held });
});

module.exports = router;
