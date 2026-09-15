const express = require('express');
const router = express.Router();
const Course = require('../models/Course');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../utils/auditLog');

// Public-ish (any logged-in user) - full catalog, used by student routine screen too.
// Paginated so this stays fast once the catalog grows well past what it is today.
router.get('/', requireAuth, async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(500, Number(req.query.limit) || 100);
  const search = (req.query.search || '').trim();

  const filter = { active: true };
  if (search) {
    filter.$or = [
      { code: new RegExp(search, 'i') },
      { title: new RegExp(search, 'i') }
    ];
  }

  const [courses, total] = await Promise.all([
    Course.find(filter).sort('code').skip((page - 1) * limit).limit(limit),
    Course.countDocuments(filter)
  ]);

  res.json({ courses, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

router.get('/:code', requireAuth, async (req, res) => {
  const course = await Course.findOne({ code: req.params.code.toUpperCase() });
  if (!course) return res.status(404).json({ error: 'Course not found' });
  res.json(course);
});

// Admin only - add/edit/delete courses & prerequisites
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const course = await Course.create(req.body);
    await logAction(req.user, 'course.create', { code: course.code, title: course.title });
    res.status(201).json(course);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:code', requireAuth, requireRole('admin'), async (req, res) => {
  const course = await Course.findOneAndUpdate(
    { code: req.params.code.toUpperCase() },
    req.body,
    { new: true, runValidators: true }
  );
  if (!course) return res.status(404).json({ error: 'Course not found' });
  await logAction(req.user, 'course.update', { code: course.code, changes: req.body });
  res.json(course);
});

router.delete('/:code', requireAuth, requireRole('admin'), async (req, res) => {
  const course = await Course.findOneAndUpdate(
    { code: req.params.code.toUpperCase() },
    { active: false }, // soft delete - keeps history for students who already took it
    { new: true }
  );
  if (!course) return res.status(404).json({ error: 'Course not found' });
  await logAction(req.user, 'course.deactivate', { code: course.code });
  res.json({ message: 'Course deactivated', course });
});

module.exports = router;
