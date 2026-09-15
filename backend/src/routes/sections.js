const express = require('express');
const Section = require('../models/Section');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/sections?course=CSE 221&term=Summer 2026 - list sections + seats left
router.get('/', requireAuth, async (req, res) => {
  const { course, term } = req.query;
  const filter = {};
  if (course) filter.courseCode = course.toUpperCase();
  if (term) filter.term = term;
  const sections = await Section.find(filter).sort({ courseCode: 1, sectionNumber: 1 });
  res.json(sections);
});

// GET /api/sections/mine - a teacher's own sections, matched by their faculty short-code
router.get('/mine', requireAuth, requireRole('teacher'), async (req, res) => {
  if (!req.dbUser.teacherShortCode) return res.json([]);
  const sections = await Section.find({ faculty: req.dbUser.teacherShortCode }).sort({ courseCode: 1 });
  res.json(sections);
});

// POST /api/sections - admin/teacher opens a new section
router.post('/', requireAuth, requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const section = await Section.create(req.body);
    res.status(201).json(section);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/sections/:id - adjust capacity, schedule, faculty, or force-close
router.patch('/:id', requireAuth, requireRole('admin', 'teacher'), async (req, res) => {
  const section = await Section.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!section) return res.status(404).json({ error: 'Section not found' });
  res.json(section);
});

// GET /api/sections/:id/roster - teacher/admin view of who's enrolled
router.get('/:id/roster', requireAuth, requireRole('admin', 'teacher'), async (req, res) => {
  const Enrollment = require('../models/Enrollment');
  const roster = await Enrollment.find({ section: req.params.id, status: 'ENROLLED' })
    .populate('student', 'name studentId email')
    .sort({ enrolledAt: 1 });
  res.json(roster);
});

module.exports = router;
