const express = require('express');
const router = express.Router();
const multer = require('multer');
const pdfParse = require('pdf-parse');
const Section = require('../models/Section');
const Semester = require('../models/Semester');
const Course = require('../models/Course');
const Config = require('../models/Config');
const { requireAuth, requireRole } = require('../middleware/auth');
const { parseAdvisingText } = require('../utils/parseAdvisingPdf');
const { getCurrentTerm } = require('../utils/currentTerm');
const { logAction } = require('../utils/auditLog');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

/**
 * POST /api/structure/import
 * multipart/form-data: file=<pdf>, term="Fall 2026", setAsCurrentTerm="true"
 *
 * Admin uploads the registrar's advising-structure PDF for the new term
 * (every ~4 months). The system reads it, figures out which semester each
 * course/section belongs to and how many seats it has, and upserts that
 * straight into the database — no more hand-editing seed JSON per term.
 *
 * Safe to re-run: existing sections get their capacity updated, new ones get
 * created. If a re-import would shrink a section below seats already taken,
 * that one section is skipped and reported back rather than silently breaking
 * enrolled students.
 */
router.post('/import', requireAuth, requireRole('admin'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No PDF uploaded (form field name: file)' });
  const { term, setAsCurrentTerm } = req.body;
  if (!term) return res.status(400).json({ error: 'term is required, e.g. "Fall 2026"' });

  let text;
  try {
    const parsed = await pdfParse(req.file.buffer);
    text = parsed.text;
  } catch (err) {
    return res.status(400).json({ error: 'Could not read this PDF: ' + err.message });
  }

  const { records, semesterCourseMap, warnings } = parseAdvisingText(text);
  if (records.length === 0) {
    return res.status(400).json({
      error: 'No sections were recognized in this PDF. Check it matches the "CODE NUM.SECTION (SEATS seats)" advising-structure format.',
      warnings
    });
  }

  // flag course codes the PDF references but that aren't in the catalog yet -
  // enrollment would silently fail for these until an admin adds them
  const catalogCodes = new Set((await Course.find({}, 'code')).map(c => c.code));
  const unknownCourses = [...new Set(records.map(r => r.courseCode))].filter(c => !catalogCodes.has(c));

  let created = 0;
  let updated = 0;
  const skippedCapacityShrink = [];

  for (const r of records) {
    const existing = await Section.findOne({
      courseCode: r.courseCode,
      sectionLabel: r.sectionLabel,
      semesterNumber: r.semesterNumber,
      term
    });

    if (existing) {
      if (r.capacity < existing.seatsTaken) {
        skippedCapacityShrink.push({
          courseCode: r.courseCode, sectionLabel: r.sectionLabel,
          pdfCapacity: r.capacity, seatsAlreadyTaken: existing.seatsTaken
        });
        continue;
      }
      existing.capacity = r.capacity;
      await existing.save();
      updated++;
    } else {
      await Section.create({
        courseCode: r.courseCode, sectionLabel: r.sectionLabel,
        semesterNumber: r.semesterNumber, term, capacity: r.capacity
      });
      created++;
    }
  }

  // upsert this term's semester -> course-list plan
  for (const [numStr, codes] of Object.entries(semesterCourseMap)) {
    await Semester.findOneAndUpdate(
      { number: Number(numStr), term },
      { $set: { courseCodes: codes } },
      { upsert: true, new: true }
    );
  }

  if (setAsCurrentTerm === 'true' || setAsCurrentTerm === true) {
    await Config.findOneAndUpdate({ key: 'currentTerm' }, { value: term }, { upsert: true });
  }

  await logAction(req.user, 'structure.import', {
    term, sectionsFound: records.length, sectionsCreated: created, sectionsUpdated: updated,
    unknownCourseCount: unknownCourses.length, fileName: req.file.originalname
  });

  res.json({
    term,
    sectionsFound: records.length,
    sectionsCreated: created,
    sectionsUpdated: updated,
    semestersTouched: Object.keys(semesterCourseMap).map(Number).sort((a, b) => a - b),
    unknownCourses,
    skippedCapacityShrink,
    warnings
  });
});

/**
 * GET /api/structure/current-term
 * Any logged-in user - which term the routine/section screens default to.
 */
router.get('/current-term', requireAuth, async (req, res) => {
  const currentTerm = await getCurrentTerm();
  res.json({ currentTerm });
});

/**
 * PUT /api/structure/current-term  { term }
 * Admin only - manually flip which term is "active" (e.g. switch back after
 * importing next term's PDF early, before it actually starts).
 */
router.put('/current-term', requireAuth, requireRole('admin'), async (req, res) => {
  const config = await Config.findOneAndUpdate(
    { key: 'currentTerm' },
    { value: req.body.term },
    { upsert: true, new: true }
  );
  await logAction(req.user, 'structure.set-current-term', { term: config.value });
  res.json({ currentTerm: config.value });
});

module.exports = router;
