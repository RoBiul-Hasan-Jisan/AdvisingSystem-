const express = require('express');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CurriculumSlot = require('../models/CurriculumSlot');
const Section = require('../models/Section');
const Course = require('../models/Course');
const Config = require('../models/Config');
const { requireAuth, requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { logAction } = require('../utils/auditLog');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const PARSER_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'parse_advising_pdf.py');

/**
 * POST /api/admin/import/preview   multipart form field "pdf"
 *
 * This is the "plan changes every 4 months" workflow: instead of hand-typing
 * a new term's curriculum and every section's seat count, admin uploads the
 * university's Advising Structure PDF for the new term and gets back exactly
 * what would be imported - nothing is written to the DB yet. Review the
 * result (especially any `note` on a section - split lab sub-groups get
 * their capacity summed and flagged) then POST it to /confirm.
 */
router.post(
  '/preview',
  requireAuth,
  requireRole('admin'),
  upload.single('pdf'),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No PDF uploaded (expected multipart field "pdf")' });

    const tmpPath = path.join(os.tmpdir(), `advising-${Date.now()}.pdf`);
    fs.writeFileSync(tmpPath, req.file.buffer);

    try {
      const result = spawnSync('python3', [PARSER_SCRIPT, tmpPath], { encoding: 'utf-8', maxBuffer: 20 * 1024 * 1024 });
      if (result.status !== 0) {
        return res.status(500).json({ error: 'Parser failed', details: result.stderr });
      }
      const parsed = JSON.parse(result.stdout);
      res.json(parsed);
    } finally {
      fs.unlink(tmpPath, () => {});
    }
  })
);

/**
 * POST /api/admin/import/confirm
 * body: the (optionally admin-edited) output of /preview -
 *       { program, term, curriculum: { "1": [codes], ... }, sections: [...], setAsCurrentTerm? }
 *
 * Upserts CurriculumSlot rows (replacing each semester's slate wholesale -
 * same semantics as PUT /api/courses/curriculum/:program/:semester) and
 * upserts Section rows by (courseCode, sectionNumber, term): existing
 * sections get their capacity updated in place (schedule/faculty added via
 * the routine-doc import or by hand are preserved, not wiped); new ones are
 * created with capacity set and an empty schedule to fill in later.
 *
 * Safe to re-run: a section whose new capacity would drop below the number
 * of students ALREADY enrolled in it is skipped rather than applied -
 * shrinking capacity below enrolledCount would silently put a section at a
 * negative seats-available state. Skipped ones come back in
 * `skippedCapacityShrink` so admin can resolve them by hand (drop students,
 * open another section, etc) instead of the import doing it silently.
 */
router.post(
  '/confirm',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { program, term, curriculum, sections, setAsCurrentTerm } = req.body;
    if (!program || !term) return res.status(400).json({ error: 'program and term are required' });

    // Flag course codes this PDF references that aren't in the catalog yet -
    // enrollment would silently 404 for these until admin adds them via /api/courses.
    const referencedCodes = new Set((sections || []).map((s) => s.courseCode));
    const catalogCodes = new Set((await Course.find({}, 'code')).map((c) => c.code));
    const unknownCourses = [...referencedCodes].filter((c) => !catalogCodes.has(c));

    let curriculumRowCount = 0;
    for (const [semester, courseCodes] of Object.entries(curriculum || {})) {
      await CurriculumSlot.deleteMany({ program, semester: Number(semester) });
      const docs = courseCodes.map((courseCode) => ({
        program,
        semester: Number(semester),
        courseCode,
        slotType: 'CORE',
      }));
      if (docs.length) await CurriculumSlot.insertMany(docs);
      curriculumRowCount += docs.length;
    }

    let created = 0;
    let updated = 0;
    const skippedCapacityShrink = [];
    for (const s of sections || []) {
      const existing = await Section.findOne({ courseCode: s.courseCode, sectionNumber: s.sectionNumber, term });
      if (existing) {
        if (s.capacity < existing.enrolledCount) {
          skippedCapacityShrink.push({
            courseCode: s.courseCode,
            sectionNumber: s.sectionNumber,
            pdfCapacity: s.capacity,
            alreadyEnrolled: existing.enrolledCount,
          });
          continue;
        }
        existing.capacity = s.capacity;
        existing.program = program;
        await existing.save();
        updated += 1;
      } else {
        await Section.create({
          courseCode: s.courseCode,
          sectionNumber: s.sectionNumber,
          term,
          program,
          capacity: s.capacity,
          enrolledCount: 0,
          schedule: [],
          faculty: '',
        });
        created += 1;
      }
    }

    if (setAsCurrentTerm) {
      await Config.findOneAndUpdate({ key: 'currentTerm' }, { value: term }, { upsert: true });
    }

    await logAction(req.dbUser, 'import.confirm', {
      program,
      term,
      curriculumRows: curriculumRowCount,
      sectionsCreated: created,
      sectionsUpdated: updated,
      skippedCapacityShrinkCount: skippedCapacityShrink.length,
      unknownCourseCount: unknownCourses.length,
      setAsCurrentTerm: !!setAsCurrentTerm,
    });

    res.json({
      ok: true,
      curriculumRows: curriculumRowCount,
      sectionsCreated: created,
      sectionsUpdated: updated,
      skippedCapacityShrink,
      unknownCourses,
    });
  })
);

module.exports = router;
