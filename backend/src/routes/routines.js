const express = require('express');
const Routine = require('../models/Routine');
const CurriculumSlot = require('../models/CurriculumSlot');
const Section = require('../models/Section');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

function timeToMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
function overlaps(a, b) {
  return a.day === b.day && timeToMin(a.startTime) < timeToMin(b.endTime) && timeToMin(b.startTime) < timeToMin(a.endTime);
}

/**
 * GET /api/routines/me?term=Summer 2026
 * Student's own routine. If none exists yet for this term, auto-generate the
 * REGULAR one straight from CurriculumSlot (program + currentSemester) and
 * save it, so the student always "first sees their regular routine".
 */
router.get('/me', requireAuth, requireRole('student'), async (req, res) => {
  const { term } = req.query;
  if (!term) return res.status(400).json({ error: 'term query param required' });

  let routine = await Routine.findOne({ student: req.dbUser._id, term });
  if (!routine) {
    const slots = await CurriculumSlot.find({
      program: req.dbUser.program,
      semester: req.dbUser.currentSemester,
    });
    routine = await Routine.create({
      student: req.dbUser._id,
      term,
      type: 'REGULAR',
      courseCodes: slots.map((s) => s.courseCode),
      createdBy: 'SYSTEM',
    });
  }

  // attach available sections per course so the frontend can render the picker directly
  const sections = await Section.find({
    courseCode: { $in: routine.courseCodes },
    term,
  });
  const byCourse = {};
  for (const s of sections) {
    byCourse[s.courseCode] = byCourse[s.courseCode] || [];
    byCourse[s.courseCode].push(s);
  }
  res.json({ routine, sectionsByCourse: byCourse });
});

/**
 * POST /api/routines/custom
 * Admin builds a one-off routine for a single student (e.g. they're retaking
 * a course or advancing one early), on top of / instead of the regular slate.
 * body: { studentId, term, courseCodes: [...], note }
 */
router.post('/custom', requireAuth, requireRole('admin'), async (req, res) => {
  const { studentId, term, courseCodes, note = '' } = req.body;
  const routine = await Routine.findOneAndUpdate(
    { student: studentId, term },
    { student: studentId, term, type: 'CUSTOM', courseCodes, note, createdBy: 'ADMIN' },
    { upsert: true, new: true }
  );
  res.json(routine);
});

/**
 * POST /api/routines/check-clash
 * Given a set of chosen sectionIds, reports any day/time overlaps - used
 * client-side right before the student confirms their section picks.
 */
router.post('/check-clash', requireAuth, async (req, res) => {
  const { sectionIds } = req.body;
  const sections = await Section.find({ _id: { $in: sectionIds } });
  const clashes = [];
  for (let i = 0; i < sections.length; i++) {
    for (let j = i + 1; j < sections.length; j++) {
      for (const a of sections[i].schedule) {
        for (const b of sections[j].schedule) {
          if (overlaps(a, b)) {
            clashes.push({
              courseA: sections[i].courseCode,
              courseB: sections[j].courseCode,
              day: a.day,
            });
          }
        }
      }
    }
  }
  res.json({ hasClash: clashes.length > 0, clashes });
});

module.exports = router;
