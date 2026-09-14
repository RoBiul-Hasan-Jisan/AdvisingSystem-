const express = require('express');
const router = express.Router();
const Section = require('../models/Section');
const Course = require('../models/Course');
const Semester = require('../models/Semester');
const Enrollment = require('../models/Enrollment');
const { requireAuth, requireRole } = require('../middleware/auth');

/**
 * GET /api/enrollment/routine
 * Returns the logged-in student's DEFAULT routine (their current semester's
 * course list mapped to open sections) plus any CUSTOM enrollments (extra
 * courses / retakes) they've already picked. This is what the student sees
 * before choosing sections.
 */
router.get('/routine', requireAuth, requireRole('student'), async (req, res) => {
  const student = req.user;
  const semesterPlan = await Semester.findOne({ number: student.currentSemester });
  const defaultCourseCodes = semesterPlan ? semesterPlan.courseCodes : [];

  const defaultSections = await Section.find({
    courseCode: { $in: defaultCourseCodes },
    semesterNumber: student.currentSemester
  });

  const myEnrollments = await Enrollment.find({ student: student._id, status: 'enrolled' }).populate('section');

  res.json({
    currentSemester: student.currentSemester,
    hasCustomRoutine: student.hasCustomRoutine,
    defaultCourseCodes,
    availableSections: defaultSections,
    myEnrollments
  });
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

  // 2. Already enrolled in this course this term? Block duplicates.
  const already = await Enrollment.findOne({
    student: student._id,
    courseCode: section.courseCode,
    term: section.term,
    status: 'enrolled'
  });
  if (already) return res.status(400).json({ error: 'Already enrolled in this course this term' });

  // 3. Atomic seat claim - the $expr condition means this only succeeds
  //    if seatsTaken < capacity AT THE MOMENT of the write, so concurrent
  //    requests can't both grab the last seat (real first-come-first-served).
  const updatedSection = await Section.findOneAndUpdate(
    { _id: sectionId, $expr: { $lt: ['$seatsTaken', '$capacity'] } },
    { $inc: { seatsTaken: 1 } },
    { new: true }
  );

  if (!updatedSection) {
    return res.status(409).json({ error: 'Section is full. Please choose another section.' });
  }

  // 4. Is this outside their default semester plan? -> custom routine
  const semesterPlan = await Semester.findOne({ number: student.currentSemester });
  const isDefault = semesterPlan && semesterPlan.courseCodes.includes(section.courseCode);
  const isExtraCourse = !isDefault;

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

  if (isExtraCourse && !student.hasCustomRoutine) {
    student.hasCustomRoutine = true;
    await student.save();
  }

  res.status(201).json({ message: 'Enrolled', enrollment, section: updatedSection });
});

/**
 * POST /api/enrollment/drop
 * body: { enrollmentId }
 * Frees the seat back up.
 */
router.post('/drop', requireAuth, requireRole('student'), async (req, res) => {
  const { enrollmentId } = req.body;
  const enrollment = await Enrollment.findOne({ _id: enrollmentId, student: req.user._id });
  if (!enrollment || enrollment.status !== 'enrolled') {
    return res.status(404).json({ error: 'Active enrollment not found' });
  }

  enrollment.status = 'dropped';
  await enrollment.save();
  await Section.findByIdAndUpdate(enrollment.section, { $inc: { seatsTaken: -1 } });

  res.json({ message: 'Dropped', enrollment });
});

/**
 * GET /api/enrollment/dashboard
 * The student's final confirmed schedule (their actual dashboard view).
 */
router.get('/dashboard', requireAuth, requireRole('student'), async (req, res) => {
  const enrollments = await Enrollment.find({ student: req.user._id, status: 'enrolled' })
    .populate('section');
  res.json({ hasCustomRoutine: req.user.hasCustomRoutine, enrollments });
});

module.exports = router;
