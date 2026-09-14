const express = require('express');
const router = express.Router();
const Section = require('../models/Section');
const { requireAuth, requireRole } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res) => {
  const { semesterNumber, term, courseCode } = req.query;
  const filter = {};
  if (semesterNumber) filter.semesterNumber = Number(semesterNumber);
  if (term) filter.term = term;
  if (courseCode) filter.courseCode = courseCode.toUpperCase();
  const sections = await Section.find(filter).populate('teacher', 'name email');
  res.json(sections);
});

// Admin creates a section; can also assign a teacher and capacity up front
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const section = await Section.create(req.body);
    res.status(201).json(section);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Admin or the assigned teacher can adjust capacity / schedule
router.put('/:id', requireAuth, requireRole('admin', 'teacher'), async (req, res) => {
  const section = await Section.findById(req.params.id);
  if (!section) return res.status(404).json({ error: 'Section not found' });

  if (req.user.role === 'teacher' && String(section.teacher) !== String(req.user._id)) {
    return res.status(403).json({ error: 'Not your section' });
  }

  // never let capacity drop below seats already taken
  if (req.body.capacity !== undefined && req.body.capacity < section.seatsTaken) {
    return res.status(400).json({ error: `Capacity can't be less than ${section.seatsTaken} seats already taken` });
  }

  Object.assign(section, req.body);
  await section.save();
  res.json(section);
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const section = await Section.findById(req.params.id);
  if (!section) return res.status(404).json({ error: 'Section not found' });
  if (section.seatsTaken > 0) {
    return res.status(400).json({ error: 'Cannot delete a section with active enrollments' });
  }
  await section.deleteOne();
  res.json({ message: 'Section deleted' });
});

module.exports = router;
