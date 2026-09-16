const express = require('express');
const router = express.Router();
const multer = require('multer');
const User = require('../models/User');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../utils/auditLog');
const { asyncHandler } = require('../middleware/asyncHandler');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

/**
 * POST /api/promotion/result
 * body: { studentId, courseCode, grade, status: 'pass'|'fail', term }
 * Admin records one course result for one student. Upserts into
 * completedCourses (so re-uploading a corrected grade just overwrites it).
 */
router.post('/result', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
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
  await logAction(req.user, 'result.record', { studentEmail: student.email, courseCode, status, term });
  res.json({ message: 'Result recorded', student });
}));

/**
 * POST /api/promotion/bulk
 * body: { results: [{ studentId, courseCode, grade, status, term }, ...] }
 * Bulk-load a whole semester's result sheet in one call (studentId here is
 * the Mongo _id, as used by the admin UI's dropdown).
 */
router.post('/bulk', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
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
  await logAction(req.user, 'result.bulk', { updated: summary.updated, errorCount: summary.errors.length });
  res.json(summary);
}));

/**
 * POST /api/promotion/bulk-csv
 * multipart/form-data: file=<csv>
 * CSV columns (header row required): studentId,courseCode,grade,status,term
 * Here studentId is the human-readable ID (User.studentId, e.g. "CSE-2201045"),
 * not a Mongo _id - this is the sheet admin/registrar staff actually work
 * from, not something built for the web UI.
 */
router.post('/bulk-csv', requireAuth, requireRole('admin'), upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No CSV uploaded (form field name: file)' });

  const text = req.file.buffer.toString('utf8');
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return res.status(400).json({ error: 'CSV has no data rows' });

  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const required = ['studentid', 'coursecode', 'grade', 'status', 'term'];
  const missingCols = required.filter(c => !header.includes(c));
  if (missingCols.length > 0) {
    return res.status(400).json({ error: `CSV is missing column(s): ${missingCols.join(', ')}. Expected header: studentId,courseCode,grade,status,term` });
  }
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));

  const summary = { updated: 0, errors: [] };

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim());
    const row = {
      studentId: cols[idx.studentid],
      courseCode: cols[idx.coursecode],
      grade: cols[idx.grade],
      status: cols[idx.status],
      term: cols[idx.term]
    };

    try {
      if (!['pass', 'fail'].includes(row.status?.toLowerCase())) {
        throw new Error(`status must be "pass" or "fail", got "${row.status}"`);
      }
      const student = await User.findOne({ studentId: row.studentId, role: 'student' });
      if (!student) throw new Error(`No student with studentId "${row.studentId}"`);

      const courseCode = row.courseCode.toUpperCase();
      const existing = student.completedCourses.find(c => c.courseCode === courseCode && c.term === row.term);
      if (existing) {
        existing.grade = row.grade;
        existing.status = row.status.toLowerCase();
      } else {
        student.completedCourses.push({ courseCode, grade: row.grade, status: row.status.toLowerCase(), term: row.term });
      }
      await student.save();
      summary.updated++;
    } catch (err) {
      summary.errors.push({ row: i + 1, ...row, error: err.message });
    }
  }

  await logAction(req.user, 'result.bulk-csv', { updated: summary.updated, errorCount: summary.errors.length, fileName: req.file.originalname });
  res.json(summary);
}));

/**
 * POST /api/promotion/promote
 * body: { term }  -- e.g. "Summer 2026"
 * Auto-promotes every student who passed EVERY course they were enrolled in
 * for that term. Students with any 'fail' stay on the same semester (they
 * retake next term, which is why extra/retake courses feed the custom-routine
 * logic in the enrollment engine).
 */
router.post('/promote', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
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

  await logAction(req.user, 'promotion.run', { term, promotedCount: promoted.length, heldCount: held.length });
  res.json({ term, promotedCount: promoted.length, heldCount: held.length, promoted, held });
}));

module.exports = router;
