const express = require('express');
const router = express.Router();
const Section = require('../models/Section');
const Course = require('../models/Course');
const Semester = require('../models/Semester');
const Enrollment = require('../models/Enrollment');
const { requireAuth, requireRole } = require('../middleware/auth');
const { findConflict } = require('../utils/scheduleConflict');
const { getCurrentTerm } = require('../utils/currentTerm');

/**
 * GET /api/enrollment/routine
 * Returns the logged-in student's DEFAULT routine (their current semester's
 * course list mapped to open sections) plus any CUSTOM enrollments (extra
 * courses / retakes) they've already picked. This is what the student sees
 * before choosing sections.
 */
router.get('/routine', requireAuth, requireRole('student'), async (req, res) => {
  const student = req.user;
  const term = await getCurrentTerm();
  if (!term) return res.status(400).json({ error: 'No term has been set up yet. Ask admin to import this term\'s advising structure.' });

  const semesterPlan = await Semester.findOne({ number: student.currentSemester, term });
  const defaultCourseCodes = semesterPlan ? semesterPlan.courseCodes : [];

  const defaultSections = await Section.find({
    courseCode: { $in: defaultCourseCodes },
    semesterNumber: student.currentSemester,
    term
  });

  // only this term's picks count toward the routine view - past terms live
  // on in the student's completedCourses history, not here. Includes both
  // confirmed and waitlisted so the routine page can show queue status.
  const myEnrollments = await Enrollment.find({ student: student._id, status: { $in: ['enrolled', 'waitlisted'] }, term }).populate('section');

  res.json({
    term,
    currentSemester: student.currentSemester,
    hasCustomRoutine: student.hasCustomRoutine,
    defaultCourseCodes,
    availableSections: defaultSections,
    myEnrollments
  });
});

/**
 * GET /api/enrollment/catalog
 * Every section open THIS TERM, across all 12 semesters, grouped by course -
 * with eligibility already computed (prerequisites met, already enrolled,
 * already passed, etc). This is what powers "add an extra course": a
 * student can pick anything here, not just their default semester's list.
 * Enrolling through the same POST /enroll below automatically marks it as
 * an extra course if it's outside their default plan.
 */
router.get('/catalog', requireAuth, requireRole('student'), async (req, res) => {
  const student = req.user;
  const term = await getCurrentTerm();
  if (!term) return res.status(400).json({ error: 'No term has been set up yet. Ask admin to import this term\'s advising structure.' });

  const sections = await Section.find({ term });
  const courseCodes = [...new Set(sections.map(s => s.courseCode))];
  const courses = await Course.find({ code: { $in: courseCodes }, active: true }).sort('code');

  const semesterPlan = await Semester.findOne({ number: student.currentSemester, term });
  const defaultCodes = new Set(semesterPlan ? semesterPlan.courseCodes : []);

  const completedPassCodes = student.completedCourses.filter(c => c.status === 'pass').map(c => c.courseCode);

  const myEnrollments = await Enrollment.find({ student: student._id, term, status: { $in: ['enrolled', 'waitlisted'] } }).populate('section');
  const enrolledCodes = new Set(myEnrollments.map(e => e.courseCode));

  const catalog = courses.map(course => {
    const priorAttempt = student.completedCourses.find(c => c.courseCode === course.code);
    const missingPrereqs = course.prerequisites.filter(p => !completedPassCodes.includes(p));
    return {
      code: course.code,
      title: course.title,
      credits: course.credits,
      category: course.category,
      prerequisites: course.prerequisites,
      missingPrereqs,
      isDefaultForYourSemester: defaultCodes.has(course.code),
      alreadyEnrolledThisTerm: enrolledCodes.has(course.code),
      alreadyPassed: priorAttempt?.status === 'pass',
      sections: sections
        .filter(s => s.courseCode === course.code)
        .map(s => ({
          _id: s._id, sectionLabel: s.sectionLabel, semesterNumber: s.semesterNumber,
          capacity: s.capacity, seatsTaken: s.seatsTaken, seatsAvailable: s.capacity - s.seatsTaken,
          schedule: s.schedule
        }))
    };
  });

  res.json({ term, catalog, myEnrollments });
});

/**
 * POST /api/enrollment/enroll
 * body: { sectionId }
 * Atomically claims a seat - first request in wins. If the course is not
 * part of the student's current default semester plan, it's flagged as an
 * extra course, which marks the student as having a custom routine.
 */
router.post('/enroll', requireAuth, requireRole('student'), async (req, res) => {
  const student = req.user;
  const { sectionId } = req.body;

  const section = await Section.findById(sectionId);
  if (!section) return res.status(404).json({ error: 'Section not found' });

  const course = await Course.findOne({ code: section.courseCode });
  if (!course) return res.status(404).json({ error: 'Course not found in catalog' });

  // 1. Prerequisite check
  const completedPassed = student.completedCourses
    .filter(c => c.status === 'pass')
    .map(c => c.courseCode);
  const missingPrereqs = course.prerequisites.filter(p => !completedPassed.includes(p));
  if (missingPrereqs.length > 0) {
    return res.status(400).json({ error: `Missing prerequisites: ${missingPrereqs.join(', ')}` });
  }

  // 2. Already enrolled OR waitlisted for this course this term? Block duplicates
  //    across sections of the same course.
  const already = await Enrollment.findOne({
    student: student._id,
    courseCode: section.courseCode,
    term: section.term,
    status: { $in: ['enrolled', 'waitlisted'] }
  });
  if (already) return res.status(400).json({ error: `Already ${already.status} in this course this term` });

  // 3. Schedule-conflict check - compare this section's day/time slots against
  //    every section the student is already enrolled in FOR THIS TERM. Runs
  //    before the seat claim so a conflicting request never touches seat counts.
  const thisTermEnrollments = await Enrollment.find({
    student: student._id,
    term: section.term,
    status: 'enrolled'
  }).populate('section');

  const conflict = findConflict(section.schedule, thisTermEnrollments);
  if (conflict) {
    return res.status(400).json({
      error: `Time conflict: overlaps with ${conflict.courseCode} on ${conflict.day} ${conflict.startTime}-${conflict.endTime}`
    });
  }

  // 4. Is this outside their default semester plan for THIS section's term? -> custom routine
  const semesterPlan = await Semester.findOne({ number: student.currentSemester, term: section.term });
  const isDefault = semesterPlan && semesterPlan.courseCodes.includes(section.courseCode);
  const isExtraCourse = !isDefault;

  // 5. Atomic seat claim - the $expr condition means this only succeeds
  //    if seatsTaken < capacity AT THE MOMENT of the write, so concurrent
  //    requests can't both grab the last seat (real first-come-first-served).
  const updatedSection = await Section.findOneAndUpdate(
    { _id: sectionId, $expr: { $lt: ['$seatsTaken', '$capacity'] } },
    { $inc: { seatsTaken: 1 } },
    { new: true }
  );

  if (isExtraCourse && !student.hasCustomRoutine) {
    student.hasCustomRoutine = true;
    await student.save();
  }

  if (!updatedSection) {
    // Section is full - join the waitlist instead of just rejecting. First
    // one to hit this branch is first out when a seat frees up (POST /drop
    // promotes by enrolledAt order below), so it's still first-come-first-served,
    // just for the queue instead of the seat itself.
    const waitlistEntry = await Enrollment.create({
      student: student._id,
      section: section._id,
      courseCode: section.courseCode,
      term: section.term,
      isExtraCourse,
      status: 'waitlisted'
    });
    const position = await Enrollment.countDocuments({
      section: section._id,
      status: 'waitlisted',
      enrolledAt: { $lte: waitlistEntry.enrolledAt }
    });
    return res.status(202).json({
      message: `Section is full — added you to the waitlist (position ${position}).`,
      waitlisted: true,
      position,
      enrollment: waitlistEntry
    });
  }

  let enrollment;
  try {
    enrollment = await Enrollment.create({
      student: student._id,
      section: section._id,
      courseCode: section.courseCode,
      term: section.term,
      isExtraCourse
    });
  } catch (err) {
    // roll back the seat claim if enrollment write fails (e.g. duplicate)
    await Section.findByIdAndUpdate(sectionId, { $inc: { seatsTaken: -1 } });
    return res.status(400).json({ error: err.message });
  }

  res.status(201).json({ message: 'Enrolled', enrollment, section: updatedSection });
});

/**
 * POST /api/enrollment/drop
 * body: { enrollmentId }
 * Frees the seat back up. If someone's on the waitlist for this section,
 * the longest-waiting one is automatically promoted into the freed seat.
 */
router.post('/drop', requireAuth, requireRole('student'), async (req, res) => {
  const { enrollmentId } = req.body;
  const enrollment = await Enrollment.findOne({ _id: enrollmentId, student: req.user._id });
  if (!enrollment || !['enrolled', 'waitlisted'].includes(enrollment.status)) {
    return res.status(404).json({ error: 'Active enrollment not found' });
  }

  const wasEnrolled = enrollment.status === 'enrolled';
  enrollment.status = 'dropped';
  await enrollment.save();

  let promoted = null;
  if (wasEnrolled) {
    await Section.findByIdAndUpdate(enrollment.section, { $inc: { seatsTaken: -1 } });

    // promote the longest-waiting student on this section's waitlist, if any
    const next = await Enrollment.findOne({ section: enrollment.section, status: 'waitlisted' }).sort('enrolledAt');
    if (next) {
      const claimed = await Section.findOneAndUpdate(
        { _id: enrollment.section, $expr: { $lt: ['$seatsTaken', '$capacity'] } },
        { $inc: { seatsTaken: 1 } },
        { new: true }
      );
      if (claimed) {
        next.status = 'enrolled';
        await next.save();
        promoted = next;
      }
    }
  }

  res.json({ message: 'Dropped', enrollment, promotedFromWaitlist: promoted });
});

/**
 * GET /api/enrollment/dashboard
 * The student's final confirmed schedule PLUS any waitlisted courses, with
 * queue position, so they know where they stand.
 */
router.get('/dashboard', requireAuth, requireRole('student'), async (req, res) => {
  const enrollments = await Enrollment.find({ student: req.user._id, status: { $in: ['enrolled', 'waitlisted'] } })
    .populate('section')
    .sort('enrolledAt');

  const withPositions = await Promise.all(enrollments.map(async (e) => {
    if (e.status !== 'waitlisted') return e.toObject();
    const position = await Enrollment.countDocuments({
      section: e.section._id, status: 'waitlisted', enrolledAt: { $lte: e.enrolledAt }
    });
    return { ...e.toObject(), waitlistPosition: position };
  }));

  res.json({ hasCustomRoutine: req.user.hasCustomRoutine, enrollments: withPositions });
});

module.exports = router;
