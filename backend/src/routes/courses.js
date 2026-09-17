const express = require('express');
const Course = require('../models/Course');
const CurriculumSlot = require('../models/CurriculumSlot');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../utils/auditLog');

const router = express.Router();

// GET /api/courses - full catalog (with prerequisites)
router.get('/', requireAuth, async (req, res) => {
  const courses = await Course.find().sort({ code: 1 });
  res.json(courses);
});

// GET /api/courses/:code - single course + who requires it as a prerequisite
router.get('/:code', requireAuth, async (req, res) => {
  const code = req.params.code.toUpperCase();
  const course = await Course.findOne({ code });
  if (!course) return res.status(404).json({ error: 'Course not found' });
  const unlocks = await Course.find({ prerequisites: code }).select('code title');
  res.json({ ...course.toObject(), unlocks });
});

// GET /api/courses/curriculum/:program - full 11/12-semester plan for a program
router.get('/curriculum/:program', requireAuth, async (req, res) => {
  const program = req.params.program.toUpperCase();
  const slots = await CurriculumSlot.find({ program }).sort({ semester: 1, courseCode: 1 });
  const byCourse = {};
  for (const c of await Course.find({ code: { $in: slots.map((s) => s.courseCode) } })) {
    byCourse[c.code] = c;
  }
  const bySemester = {};
  for (const s of slots) {
    bySemester[s.semester] = bySemester[s.semester] || [];
    bySemester[s.semester].push({ ...byCourse[s.courseCode]?.toObject(), slotType: s.slotType });
  }
  res.json(bySemester);
});

// POST /api/courses - admin adds a course
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const course = await Course.create(req.body);
    await logAction(req.dbUser, 'course.create', { code: course.code, title: course.title });
    res.status(201).json(course);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/courses/:code - admin edits a course (e.g. prerequisites)
router.patch('/:code', requireAuth, requireRole('admin'), async (req, res) => {
  const course = await Course.findOneAndUpdate(
    { code: req.params.code.toUpperCase() },
    req.body,
    { new: true }
  );
  if (!course) return res.status(404).json({ error: 'Course not found' });
  await logAction(req.dbUser, 'course.update', { code: course.code, changes: req.body });
  res.json(course);
});

// DELETE /api/courses/:code - admin removes a course from the catalog
router.delete('/:code', requireAuth, requireRole('admin'), async (req, res) => {
  const code = req.params.code.toUpperCase();
  await Course.deleteOne({ code });
  await logAction(req.dbUser, 'course.delete', { code });
  res.json({ ok: true });
});

// PUT /api/courses/curriculum/:program/:semester - admin sets which courses that semester offers
router.put('/curriculum/:program/:semester', requireAuth, requireRole('admin'), async (req, res) => {
  const program = req.params.program.toUpperCase();
  const semester = Number(req.params.semester);
  const { courseCodes = [], slotType = 'CORE' } = req.body;

  await CurriculumSlot.deleteMany({ program, semester });
  const docs = courseCodes.map((courseCode) => ({
    program,
    semester,
    courseCode: courseCode.toUpperCase(),
    slotType,
  }));
  await CurriculumSlot.insertMany(docs);
  await logAction(req.dbUser, 'curriculum.update', { program, semester, courseCodes: docs.map((d) => d.courseCode) });
  res.json({ ok: true, count: docs.length });
});

module.exports = router;
