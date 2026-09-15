const express = require('express');
const User = require('../models/User');
const CurriculumSlot = require('../models/CurriculumSlot');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

// GET /api/admin/students?program=CSE&semester=3
router.get('/students', async (req, res) => {
  const { program, semester } = req.query;
  const filter = { role: 'student' };
  if (program) filter.program = program.toUpperCase();
  if (semester) filter.currentSemester = Number(semester);
  const students = await User.find(filter).sort({ studentId: 1 });
  res.json(students);
});

// POST /api/admin/students - add a student. The account must already exist
// in Firebase Auth (frontend signs them up there first); this links it.
router.post('/students', async (req, res) => {
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
    res.status(201).json(student);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/admin/students/:id
router.delete('/students/:id', async (req, res) => {
  await User.deleteOne({ _id: req.params.id, role: 'student' });
  res.json({ ok: true });
});

/**
 * POST /api/admin/results
 * Bulk result upload for a term.
 * body: { term, results: [{ studentId(Mongo _id), courseCode, grade, passed }] }
 * Pushes into each student's courseHistory. Doesn't promote by itself -
 * promotion is a separate explicit action (see below) so admin reviews first.
 */
router.post('/results', async (req, res) => {
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
  res.json({ ok: true, modified: out.modifiedCount });
});

/**
 * POST /api/admin/promote
 * body: { studentIds: [...] }  OR  { program, semester } to promote a whole batch
 * Moves currentSemester += 1 for each targeted student. Admin decides who
 * qualifies (this endpoint doesn't auto-check pass/fail - keeps the human
 * in the loop, matching "admin can do anything" from the requirements).
 */
router.post('/promote', async (req, res) => {
  const { studentIds, program, semester } = req.body;
  const filter = studentIds
    ? { _id: { $in: studentIds } }
    : { program: program.toUpperCase(), currentSemester: Number(semester) };

  const result = await User.updateMany(filter, { $inc: { currentSemester: 1 } });
  res.json({ ok: true, promoted: result.modifiedCount });
});

// PATCH /api/admin/students/:id - general override (status, program, semester, etc.)
router.patch('/students/:id', async (req, res) => {
  const student = await User.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!student) return res.status(404).json({ error: 'Student not found' });
  res.json(student);
});

module.exports = router;
