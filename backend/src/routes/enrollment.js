const express = require('express');
const Section = require('../models/Section');
const Enrollment = require('../models/Enrollment');
const Course = require('../models/Course');
const Term = require('../models/Term');
const { requireAuth, requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

/** Checks the student has passed every prerequisite for courseCode. */
async function checkPrerequisites(student, courseCode) {
  const course = await Course.findOne({ code: courseCode });
  if (!course || course.prerequisites.length === 0) return { ok: true, missing: [] };
  const passedCodes = new Set(student.courseHistory.filter((c) => c.passed).map((c) => c.courseCode));
  const missing = course.prerequisites.filter((p) => !passedCodes.has(p));
  return { ok: missing.length === 0, missing };
}

/** Is `now` inside this program/term's enrollment window? No Term doc = no restriction (back-compat / admin hasn't set one). */
async function checkEnrollmentWindow(program, term) {
  const window = await Term.findOne({ program, term });
  if (!window) return { ok: true };
  const now = new Date();
  if (now < window.enrollmentStart) return { ok: false, reason: `Enrollment opens ${window.enrollmentStart.toDateString()}` };
  if (now > window.enrollmentEnd) return { ok: false, reason: `Enrollment closed on ${window.enrollmentEnd.toDateString()}` };
  return { ok: true, window };
}

/** Sums credits of the student's currently ENROLLED courses this term and checks against the limit. */
async function checkCreditLimit(student, term, newCourseCredits, creditLimit) {
  if (!creditLimit) return { ok: true };
  const active = await Enrollment.find({ student: student._id, term, status: 'ENROLLED' });
  const activeCourses = await Course.find({ code: { $in: active.map((a) => a.courseCode) } });
  const currentCredits = activeCourses.reduce((sum, c) => sum + c.credits, 0);
  const projected = currentCredits + newCourseCredits;
  return { ok: projected <= creditLimit, currentCredits, projected, limit: creditLimit };
}

function timeToMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
function overlaps(a, b) {
  return a.day === b.day && timeToMin(a.startTime) < timeToMin(b.endTime) && timeToMin(b.startTime) < timeToMin(a.endTime);
}

/** Checks the candidate section's schedule against every section the student is currently ENROLLED in this term. */
async function checkScheduleClash(student, term, candidateSection) {
  const active = await Enrollment.find({ student: student._id, term, status: 'ENROLLED' }).populate('section');
  for (const e of active) {
    if (!e.section) continue;
    for (const a of candidateSection.schedule) {
      for (const b of e.section.schedule) {
        if (overlaps(a, b)) return { ok: false, clashesWith: e.courseCode, day: a.day };
      }
    }
  }
  return { ok: true };
}

/**
 * POST /api/enrollment/enroll   body: { sectionId }
 * Runs, in order: window check -> prerequisite check -> duplicate check ->
 * credit-limit check -> schedule-clash check -> atomic seat grab (or waitlist).
 *
 * Concurrency-safety: the seat grab is a single atomic findOneAndUpdate with
 * the condition enrolledCount < capacity. Mongo guarantees only one of two
 * simultaneous requests can match+increment; the loser falls through to the
 * waitlist branch, ordered by queuedAt - genuine FCFS, no polling or lock needed.
 */
router.post(
  '/enroll',
  requireAuth,
  requireRole('student'),
  asyncHandler(async (req, res) => {
    const { sectionId } = req.body;
    const section = await Section.findById(sectionId);
    if (!section) return res.status(404).json({ error: 'Section not found' });
    if (!section.isOpen) return res.status(400).json({ error: 'Section is closed for enrollment' });

    const student = req.dbUser;

    const win = await checkEnrollmentWindow(student.program, section.term);
    if (!win.ok) return res.status(400).json({ error: win.reason });

    const prereq = await checkPrerequisites(student, section.courseCode);
    if (!prereq.ok) return res.status(400).json({ error: `Prerequisite not met: ${prereq.missing.join(', ')}` });

    const existing = await Enrollment.findOne({
      student: student._id,
      courseCode: section.courseCode,
      term: section.term,
      status: { $in: ['ENROLLED', 'WAITLISTED'] },
    });
    if (existing) return res.status(400).json({ error: 'Already enrolled/waitlisted in this course this term' });

    const course = await Course.findOne({ code: section.courseCode });
    const creditCheck = await checkCreditLimit(student, section.term, course.credits, win.window?.creditLimit);
    if (!creditCheck.ok) {
      return res.status(400).json({
        error: `Credit limit exceeded: ${creditCheck.currentCredits} + ${course.credits} > ${creditCheck.limit}`,
      });
    }

    const clash = await checkScheduleClash(student, section.term, section);
    if (!clash.ok) {
      return res.status(400).json({ error: `Schedule clash with ${clash.clashesWith} on ${clash.day}` });
    }

    // --- atomic seat grab ---
    const grabbed = await Section.findOneAndUpdate(
      { _id: sectionId, $expr: { $lt: ['$enrolledCount', '$capacity'] } },
      { $inc: { enrolledCount: 1 } },
      { new: true }
    );

    if (grabbed) {
      const enrollment = await Enrollment.create({
        student: student._id,
        section: section._id,
        courseCode: section.courseCode,
        term: section.term,
        status: 'ENROLLED',
        assignedBy: 'STUDENT',
      });
      return res.status(201).json({ status: 'ENROLLED', enrollment });
    }

    // Section was full by the time we tried -> join the FCFS waitlist queue.
    const queuedAt = new Date();
    await Section.updateOne({ _id: sectionId }, { $push: { waitlist: { student: student._id, queuedAt } } });
    const enrollment = await Enrollment.create({
      student: student._id,
      section: section._id,
      courseCode: section.courseCode,
      term: section.term,
      status: 'WAITLISTED',
      assignedBy: 'STUDENT',
    });
    const refreshed = await Section.findById(sectionId);
    const position = [...refreshed.waitlist].sort((a, b) => a.queuedAt - b.queuedAt)
      .findIndex((w) => String(w.student) === String(student._id)) + 1;
    res.status(202).json({ status: 'WAITLISTED', enrollment, waitlistPosition: position });
  })
);

/**
 * POST /api/enrollment/drop   body: { enrollmentId }
 * Frees a seat and auto-promotes the first person in that section's waitlist
 * (true FCFS - whoever queued earliest gets the seat).
 */
router.post(
  '/drop',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { enrollmentId } = req.body;
    const enrollment = await Enrollment.findById(enrollmentId);
    if (!enrollment) return res.status(404).json({ error: 'Enrollment not found' });

    const isOwner = String(enrollment.student) === String(req.dbUser._id);
    const isStaff = ['admin', 'teacher'].includes(req.dbUser.role);
    if (!isOwner && !isStaff) return res.status(403).json({ error: 'Not allowed' });

    if (enrollment.status === 'DROPPED') return res.json({ ok: true, already: true });

    const wasEnrolled = enrollment.status === 'ENROLLED';
    enrollment.status = 'DROPPED';
    await enrollment.save();

    if (!wasEnrolled) return res.json({ ok: true }); // dropping a waitlist slot doesn't free a seat

    const section = await Section.findById(enrollment.section);
    if (!section) return res.json({ ok: true });

    const sorted = [...section.waitlist].sort((a, b) => a.queuedAt - b.queuedAt);
    const next = sorted[0];

    if (!next) {
      await Section.updateOne({ _id: section._id }, { $inc: { enrolledCount: -1 } });
      return res.json({ ok: true, promoted: null });
    }

    await Section.updateOne({ _id: section._id }, { $pull: { waitlist: { _id: next._id } } });
    await Enrollment.findOneAndUpdate(
      { student: next.student, section: section._id, status: 'WAITLISTED' },
      { status: 'ENROLLED' }
    );

    res.json({ ok: true, promoted: next.student });
  })
);

/**
 * GET /api/enrollment/me?term=Summer 2026
 * A student's own enrollment status, with live waitlist position attached
 * to any WAITLISTED row (so the frontend can show "you're #3 in line").
 */
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { term } = req.query;
    const filter = { student: req.dbUser._id };
    if (term) filter.term = term;
    const rows = await Enrollment.find(filter).populate('section').sort({ enrolledAt: 1 });

    const withPositions = rows.map((e) => {
      const obj = e.toObject();
      if (e.status === 'WAITLISTED' && e.section) {
        const sorted = [...e.section.waitlist].sort((a, b) => a.queuedAt - b.queuedAt);
        obj.waitlistPosition = sorted.findIndex((w) => String(w.student) === String(req.dbUser._id)) + 1;
      }
      return obj;
    });
    res.json(withPositions);
  })
);

/**
 * POST /api/enrollment/admin-assign
 * Admin/teacher force-places a student into a section, bypassing the queue
 * and the window/credit/clash checks (still respects capacity unless force=true).
 */
router.post(
  '/admin-assign',
  requireAuth,
  requireRole('admin', 'teacher'),
  asyncHandler(async (req, res) => {
    const { studentId, sectionId, force = false } = req.body;
    const section = await Section.findById(sectionId);
    if (!section) return res.status(404).json({ error: 'Section not found' });

    if (section.enrolledCount >= section.capacity && !force) {
      return res.status(400).json({ error: 'Section full (pass force:true to override)' });
    }

    await Section.updateOne({ _id: sectionId }, { $inc: { enrolledCount: 1 } });
    const enrollment = await Enrollment.create({
      student: studentId,
      section: sectionId,
      courseCode: section.courseCode,
      term: section.term,
      status: 'ENROLLED',
      assignedBy: req.dbUser.role === 'admin' ? 'ADMIN' : 'TEACHER',
    });
    res.status(201).json(enrollment);
  })
);

module.exports = router;
