const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const User = require('../models/User');
const CurriculumSlot = require('../models/CurriculumSlot');
const { requireAuth, requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { logAction } = require('../utils/auditLog');
const { parsePassed } = require('../utils/parsePassed');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
router.use(requireAuth, requireRole('admin'));

// GET /api/admin/students?program=CSE&semester=3
router.get(
  '/students',
  asyncHandler(async (req, res) => {
    const { program, semester } = req.query;
    const filter = { role: 'student' };
    if (program) filter.program = program.toUpperCase();
    if (semester) filter.currentSemester = Number(semester);
    const students = await User.find(filter).sort({ studentId: 1 });
    res.json(students);
  })
);

// POST /api/admin/students - add a student. The account must already exist
// in Firebase Auth (frontend signs them up there first); this links it.
router.post(
  '/students',
  asyncHandler(async (req, res) => {
    const { firebaseUid, name, email, studentId, program, currentSemester = 1 } = req.body;
    try {
      const student = await User.create({
        firebaseUid,
        name,
        email,
        studentId,
        program,
        currentSemester,
        role: 'student',
      });
      await logAction(req.dbUser, 'student.create', { studentId: student.studentId, email: student.email });
      res.status(201).json(student);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  })
);

// DELETE /api/admin/students/:id
router.delete(
  '/students/:id',
  asyncHandler(async (req, res) => {
    const student = await User.findOne({ _id: req.params.id, role: 'student' });
    await User.deleteOne({ _id: req.params.id, role: 'student' });
    if (student) await logAction(req.dbUser, 'student.delete', { studentId: student.studentId, email: student.email });
    res.json({ ok: true });
  })
);

/**
 * POST /api/admin/results
 * Bulk result upload for a term.
 * body: { term, results: [{ studentId(Mongo _id), courseCode, grade, passed }] }
 * Pushes into each student's courseHistory. Doesn't promote by itself -
 * promotion is a separate explicit action (see below) so admin reviews first.
 */
router.post(
  '/results',
  asyncHandler(async (req, res) => {
    const { term, results } = req.body;
    const ops = results.map((r) => ({
      updateOne: {
        filter: { _id: r.studentId },
        update: {
          $push: {
            courseHistory: { courseCode: r.courseCode.toUpperCase(), grade: r.grade, term, passed: r.passed },
          },
        },
      },
    }));
    const out = await User.bulkWrite(ops);
    await logAction(req.dbUser, 'result.bulk', { term, rowCount: results.length, modified: out.modifiedCount });
    res.json({ ok: true, modified: out.modifiedCount });
  })
);

/**
 * POST /api/admin/results/csv   multipart field "csv"
 * Columns: studentId,courseCode,grade,passed  (studentId = the human-readable
 * Student ID, not the Mongo _id - a spreadsheet from the registrar's office
 * has that, not our internal IDs). "passed" accepts true/false/1/0/pass/fail.
 * Rows whose studentId doesn't match anyone are skipped and listed in
 * `unmatched` so admin can fix and re-upload just those.
 */
router.post(
  '/results/csv',
  upload.single('csv'),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No CSV uploaded (expected multipart field "csv")' });
    const { term } = req.body;
    if (!term) return res.status(400).json({ error: 'term is required' });

    const records = parse(req.file.buffer.toString('utf-8'), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    const studentIds = [...new Set(records.map((r) => r.studentId))];
    const students = await User.find({ studentId: { $in: studentIds } });
    const byStudentId = new Map(students.map((s) => [s.studentId, s._id]));

    const unmatched = [];
    const ops = [];
    for (const r of records) {
      const mongoId = byStudentId.get(r.studentId);
      if (!mongoId) {
        unmatched.push(r.studentId);
        continue;
      }
      const passed = parsePassed(r.passed);
      ops.push({
        updateOne: {
          filter: { _id: mongoId },
          update: {
            $push: { courseHistory: { courseCode: r.courseCode.toUpperCase(), grade: r.grade, term, passed } },
          },
        },
      });
    }

    const out = ops.length ? await User.bulkWrite(ops) : { modifiedCount: 0 };
    await logAction(req.dbUser, 'result.bulk-csv', {
      term,
      rowCount: records.length,
      modified: out.modifiedCount,
      unmatchedCount: new Set(unmatched).size,
      fileName: req.file.originalname,
    });
    res.json({ ok: true, modified: out.modifiedCount, rowCount: records.length, unmatched: [...new Set(unmatched)] });
  })
);

/**
 * POST /api/admin/promote
 * body: { studentIds: [...] }  OR  { program, semester } to promote a whole batch
 * Moves currentSemester += 1 for each targeted student. Admin decides who
 * qualifies (this endpoint doesn't auto-check pass/fail - keeps the human
 * in the loop, matching "admin can do anything" from the requirements).
 */
router.post(
  '/promote',
  asyncHandler(async (req, res) => {
    const { studentIds, program, semester } = req.body;
    const filter = studentIds
      ? { _id: { $in: studentIds } }
      : { program: program.toUpperCase(), currentSemester: Number(semester) };

    const result = await User.updateMany(filter, { $inc: { currentSemester: 1 } });
    await logAction(req.dbUser, 'promotion.run', {
      scope: studentIds ? { studentIds } : { program, semester },
      promoted: result.modifiedCount,
    });
    res.json({ ok: true, promoted: result.modifiedCount });
  })
);

// PATCH /api/admin/students/:id - general override (status, program, semester, etc.)
router.patch(
  '/students/:id',
  asyncHandler(async (req, res) => {
    const student = await User.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!student) return res.status(404).json({ error: 'Student not found' });
    await logAction(req.dbUser, 'student.update', { studentId: student.studentId, changes: req.body });
    res.json(student);
  })
);

module.exports = router;
