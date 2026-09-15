const express = require('express');
const router = express.Router();
const Section = require('../models/Section');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../utils/auditLog');

// Paginated - a full term's sections (~300+, per the real advising PDF) is too
// much to dump in one ledger table once you're past a single small program.
router.get('/', requireAuth, async (req, res) => {
  const { semesterNumber, term, courseCode, teacher } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(500, Number(req.query.limit) || 100);

  const filter = {};
  if (semesterNumber) filter.semesterNumber = Number(semesterNumber);
  if (term) filter.term = term;
  if (courseCode) filter.courseCode = courseCode.toUpperCase();
  if (teacher === 'me' && req.user.role === 'teacher') filter.teacher = req.user._id;

  const [sections, total] = await Promise.all([
    Section.find(filter).populate('teacher', 'name email')
      .sort('courseCode sectionLabel').skip((page - 1) * limit).limit(limit),
    Section.countDocuments(filter)
  ]);

  res.json({ sections, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

// Admin creates a section; can also assign a teacher and capacity up front
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const section = await Section.create(req.body);
    await logAction(req.user, 'section.create', { courseCode: section.courseCode, sectionLabel: section.sectionLabel, term: section.term, capacity: section.capacity });
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
  await logAction(req.user, 'section.update', { courseCode: section.courseCode, sectionLabel: section.sectionLabel, changes: req.body });
  res.json(section);
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const section = await Section.findById(req.params.id);
  if (!section) return res.status(404).json({ error: 'Section not found' });
  if (section.seatsTaken > 0) {
    return res.status(400).json({ error: 'Cannot delete a section with active enrollments' });
  }
  await section.deleteOne();
  await logAction(req.user, 'section.delete', { courseCode: section.courseCode, sectionLabel: section.sectionLabel });
  res.json({ message: 'Section deleted' });
});

module.exports = router;
