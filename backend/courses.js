const express = require('express');
const router = express.Router();
const Course = require('../models/Course');
const { requireAuth, requireRole } = require('../middleware/auth');

// Public-ish (any logged-in user) - full catalog, used by student routine screen too
router.get('/', requireAuth, async (req, res) => {
  const courses = await Course.find({ active: true }).sort('code');
  res.json(courses);
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
  res.json(course);
});

router.delete('/:code', requireAuth, requireRole('admin'), async (req, res) => {
  const course = await Course.findOneAndUpdate(
    { code: req.params.code.toUpperCase() },
    { active: false }, // soft delete - keeps history for students who already took it
    { new: true }
  );
  if (!course) return res.status(404).json({ error: 'Course not found' });
  res.json({ message: 'Course deactivated', course });
});

module.exports = router;
