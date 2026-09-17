const express = require('express');
const Routine = require('../models/Routine');
const CurriculumSlot = require('../models/CurriculumSlot');
const Section = require('../models/Section');
const CourseRequest = require('../models/CourseRequest');
const Notification = require('../models/Notification');
const { findAllConflicts } = require('../utils/scheduleConflict');
const { requireAuth, requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { logAction } = require('../utils/auditLog');

const router = express.Router();

/**
 * GET /api/routines/me?term=Summer 2026
 * Student's own routine. If none exists yet for this term, auto-generate the
 * REGULAR one straight from CurriculumSlot (program + currentSemester) and
 * save it, so the student always "first sees their regular routine".
 */
router.get(
  '/me',
  requireAuth,
  requireRole('student'),
  asyncHandler(async (req, res) => {
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
  })
);

/**
 * POST /api/routines/custom
 * Admin builds a one-off routine for a single student (e.g. they're retaking
 * a course or advancing one early), on top of / instead of the regular slate.
 * body: { studentId, term, courseCodes: [...], note }
 */
router.post(
  '/custom',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { studentId, term, courseCodes, note = '' } = req.body;
    const routine = await Routine.findOneAndUpdate(
      { student: studentId, term },
      { student: studentId, term, type: 'CUSTOM', courseCodes, note, createdBy: 'ADMIN' },
      { upsert: true, new: true }
    );
    await logAction(req.dbUser, 'routine.custom-set', { studentId, term, courseCodes });
    res.json(routine);
  })
);

/**
 * POST /api/routines/check-clash
 * Given a set of chosen sectionIds, reports any day/time overlaps - used
 * client-side right before the student confirms their section picks.
 */
router.post(
  '/check-clash',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { sectionIds } = req.body;
    const sections = await Section.find({ _id: { $in: sectionIds } });
    const clashes = findAllConflicts(sections);
    res.json({ hasClash: clashes.length > 0, clashes });
  })
);

/**
 * POST /api/routines/request   (student)
 * body: { term, courseCode, reason }
 * The student-facing front door for "I want an extra/retake course" - files
 * a CourseRequest for admin to review, instead of the student having no way
 * to ask and admin having no visibility into who wants what.
 */
router.post(
  '/request',
  requireAuth,
  requireRole('student'),
  asyncHandler(async (req, res) => {
    const { term, courseCode, reason = '' } = req.body;
    if (!term || !courseCode) return res.status(400).json({ error: 'term and courseCode are required' });

    const existing = await CourseRequest.findOne({
      student: req.dbUser._id,
      term,
      courseCode: courseCode.toUpperCase(),
      status: 'PENDING',
    });
    if (existing) return res.status(400).json({ error: 'You already have a pending request for this course' });

    const request = await CourseRequest.create({
      student: req.dbUser._id,
      term,
      courseCode: courseCode.toUpperCase(),
      reason,
    });
    res.status(201).json(request);
  })
);

// GET /api/routines/requests?status=PENDING&term=Summer 2026   (admin)
router.get(
  '/requests',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { status, term } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (term) filter.term = term;
    const requests = await CourseRequest.find(filter)
      .populate('student', 'name studentId program currentSemester')
      .sort({ createdAt: -1 });
    res.json(requests);
  })
);

/**
 * POST /api/routines/requests/:id/approve   (admin)
 * body: { note }
 * Folds the requested course into that student's routine for the term
 * (creating a CUSTOM routine off their current REGULAR/CUSTOM one if needed)
 * and notifies them - this is what turns a request into something the
 * student actually sees on their routine page.
 */
router.post(
  '/requests/:id/approve',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { note = '' } = req.body;
    const request = await CourseRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.status !== 'PENDING') return res.status(400).json({ error: 'Request already reviewed' });

    request.status = 'APPROVED';
    request.reviewNote = note;
    request.reviewedBy = req.dbUser._id;
    await request.save();

    const existingRoutine = await Routine.findOne({ student: request.student, term: request.term });
    const baseCourses = existingRoutine ? existingRoutine.courseCodes : [];
    const courseCodes = [...new Set([...baseCourses, request.courseCode])];
    const routine = await Routine.findOneAndUpdate(
      { student: request.student, term: request.term },
      {
        student: request.student,
        term: request.term,
        type: 'CUSTOM',
        courseCodes,
        note: existingRoutine?.note ? `${existingRoutine.note}; +${request.courseCode}` : `+${request.courseCode}`,
        createdBy: 'ADMIN',
      },
      { upsert: true, new: true }
    );

    await Notification.create({
      user: request.student,
      type: 'REQUEST_APPROVED',
      message: `Your request to add ${request.courseCode} was approved - check your routine.`,
    });

    await logAction(req.dbUser, 'request.approve', { requestId: request._id, student: request.student, courseCode: request.courseCode, term: request.term });

    res.json({ request, routine });
  })
);

// POST /api/routines/requests/:id/reject   (admin)   body: { note }
router.post(
  '/requests/:id/reject',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { note = '' } = req.body;
    const request = await CourseRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.status !== 'PENDING') return res.status(400).json({ error: 'Request already reviewed' });

    request.status = 'REJECTED';
    request.reviewNote = note;
    request.reviewedBy = req.dbUser._id;
    await request.save();

    await Notification.create({
      user: request.student,
      type: 'REQUEST_REJECTED',
      message: `Your request to add ${request.courseCode} was declined.${note ? ` Note: ${note}` : ''}`,
    });

    await logAction(req.dbUser, 'request.reject', { requestId: request._id, student: request.student, courseCode: request.courseCode, term: request.term, note });

    res.json(request);
  })
);

module.exports = router;
