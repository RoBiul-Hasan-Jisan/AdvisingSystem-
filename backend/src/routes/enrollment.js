const express = require('express');
const Section = require('../models/Section');
const Enrollment = require('../models/Enrollment');
const Course = require('../models/Course');
const Term = require('../models/Term');
const Notification = require('../models/Notification');
const { findConflict } = require('../utils/scheduleConflict');
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

/** Checks the candidate section's schedule against every section the student is currently ENROLLED in this term. */
async function checkScheduleClash(student, term, candidateSection) {
  const active = await Enrollment.find({ student: student._id, term, status: 'ENROLLED' }).populate('section');
  const existingSchedules = active.filter((e) => e.section).map((e) => ({ courseCode: e.courseCode, schedule: e.section.schedule }));
  const conflict = findConflict(candidateSection.schedule, existingSchedules);
  return conflict ? { ok: false, clashesWith: conflict.courseCode, day: conflict.day } : { ok: true };
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
      // Roll back the seat claim if the Enrollment write fails (e.g. a race
      // where a second request for a DIFFERENT section of the same course
      // slipped past the earlier duplicate check and hits the DB-level
      // partial unique index on {student, courseCode, term} here instead).
      // Without this, the seat would stay claimed with no Enrollment behind
      // it - a phantom taken seat nobody can ever release.
      let enrollment;
      try {
        enrollment = await Enrollment.create({
          student: student._id,
          section: section._id,
          courseCode: section.courseCode,
          term: section.term,
          status: 'ENROLLED',
          assignedBy: 'STUDENT',
        });
      } catch (err) {
        await Section.updateOne({ _id: sectionId }, { $inc: { enrolledCount: -1 } });
        return res.status(400).json({ error: 'Could not complete enrollment: ' + err.message });
      }
      return res.status(201).json({ status: 'ENROLLED', enrollment });
    }

    // Section was full by the time we tried -> join the FCFS waitlist queue.
    const queuedAt = new Date();
    await Section.updateOne({ _id: sectionId }, { $push: { waitlist: { student: student._id, queuedAt } } });
    let enrollment;
    try {
      enrollment = await Enrollment.create({
        student: student._id,
        section: section._id,
        courseCode: section.courseCode,
        term: section.term,
        status: 'WAITLISTED',
        assignedBy: 'STUDENT',
      });
    } catch (err) {
      // same rollback idea, for the waitlist-join branch
      await Section.updateOne({ _id: sectionId }, { $pull: { waitlist: { student: student._id, queuedAt } } });
      return res.status(400).json({ error: 'Could not join waitlist: ' + err.message });
    }
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
    await Notification.create({
      user: next.student,
      type: 'WAITLIST_PROMOTED',
      message: `You've been moved off the waitlist and enrolled in ${section.courseCode} (Section ${section.sectionNumber}).`,
    });

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
