// Run after `npm run seed`. Builds a full demo roster - 1 admin, 5 teachers
// (using the same short-codes already on the seeded sections, so "my
// sections" works for real on first login), and 100 students spread across
// semesters 1-11 - then runs 40 of those semester-5 students through an
// actual registration rush against the real seeded section capacities, so
// some land ENROLLED and some land WAITLISTED exactly the way the live
// /api/enrollment/enroll route would leave them (same fields, same
// enrolledCount/waitlist bookkeeping) - nothing here is faked or shrunk.
//
// Usage: node src/seed/demoSeed.js
// (all emails/passwords are fixed demo values - printed at the end)
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const initFirebase = require('../config/firebase');
const User = require('../models/User');
const Section = require('../models/Section');
const CurriculumSlot = require('../models/CurriculumSlot');
const Config = require('../models/Config');
const Term = require('../models/Term');
const Enrollment = require('../models/Enrollment');

const TERM = 'Summer 2026';
const PROGRAM = 'CSE';
const DEMO_PASSWORD = 'Demo1234!';

const ADMIN = { role: 'admin', name: 'Advising Office', email: 'admin@demo.local' };

// Short-codes match the `faculty` field already on the seeded sections
// (sections.data.js) - creating teachers with these codes means "my
// sections" resolves correctly with zero extra wiring.
const TEACHERS = [
  { role: 'teacher', name: 'Parvez Hasan', email: 'teacher.ph@demo.local', teacherShortCode: 'PH' },
  { role: 'teacher', name: 'Anjuman Ara', email: 'teacher.anj@demo.local', teacherShortCode: 'ANJ' },
  { role: 'teacher', name: 'Sadia Anwar Hridi', email: 'teacher.sah@demo.local', teacherShortCode: 'SAH' },
  { role: 'teacher', name: 'Judith Costa', email: 'teacher.jud@demo.local', teacherShortCode: 'JUD' },
  { role: 'teacher', name: 'Pranab Roy Mazumder', email: 'teacher.prm@demo.local', teacherShortCode: 'PRM' },
];

const FIRST_NAMES = ['Tanvir', 'Farhana', 'Rakib', 'Mahia', 'Shuvo', 'Nusrat', 'Imran', 'Proma', 'Adib', 'Sadia'];
const LAST_NAMES = ['Ahmed', 'Rahman', 'Chowdhury', 'Islam', 'Karim', 'Hossain', 'Akter', 'Sultana', 'Hasan', 'Khan'];

// 40 of the 100 land in semester 5 - the only semester with seeded sections -
// so there's a real cohort competing for real seats. The rest are spread
// across every other semester just so the roster/curriculum pages have a
// realistic, non-empty student body at every stage of the program.
const OTHER_SEMESTERS = [1, 2, 3, 4, 6, 7, 8, 9, 10, 11];

function buildStudents() {
  const students = [];
  for (let i = 0; i < 100; i++) {
    const first = FIRST_NAMES[i % 10];
    const last = LAST_NAMES[Math.floor(i / 10) % 10];
    const currentSemester = i < 40 ? 5 : OTHER_SEMESTERS[(i - 40) % OTHER_SEMESTERS.length];
    students.push({
      role: 'student',
      name: `${first} ${last}`,
      email: `student${i + 1}@demo.local`,
      studentId: `CSE22${String(i + 1).padStart(3, '0')}`,
      program: PROGRAM,
      currentSemester,
    });
  }
  return students;
}

async function upsertUser(fb, account, courseHistory) {
  let firebaseUser;
  try {
    firebaseUser = await fb.auth().getUserByEmail(account.email);
  } catch {
    firebaseUser = await fb.auth().createUser({
      email: account.email,
      password: DEMO_PASSWORD,
      displayName: account.name,
    });
  }

  const doc = { firebaseUid: firebaseUser.uid, name: account.name, email: account.email, role: account.role };
  if (account.role === 'teacher') doc.teacherShortCode = account.teacherShortCode;
  if (account.role === 'student') {
    doc.studentId = account.studentId;
    doc.program = account.program;
    doc.currentSemester = account.currentSemester;
    doc.courseHistory = courseHistory || [];
  }

  return User.findOneAndUpdate({ firebaseUid: firebaseUser.uid }, doc, { upsert: true, new: true });
}

/** Every course from semesters below the student's current one, marked passed - so
 *  prerequisite checks on their current semester's courses (and on extra-course
 *  requests) behave exactly as they would for a real, progressing student. */
async function buildCourseHistory(program, currentSemester) {
  if (currentSemester <= 1) return [];
  const priorSlots = await CurriculumSlot.find({ program, semester: { $lt: currentSemester } });
  return priorSlots.map((slot) => ({ courseCode: slot.courseCode, grade: 'A', term: 'Prior term (seed)', passed: true }));
}

// Per-course weighting for which of a course's sections a student prefers -
// most people want the same convenient time slot, which is exactly what
// turns a seat limit into a real bottleneck. CSE 221 is weighted harder on
// its first section on purpose, to guarantee at least one full-size
// (35-seat) section also overflows into a waitlist, not just the small labs.
const SECTION_WEIGHTS = {
  'CSE 221': [0.9, 0.07, 0.03],
  DEFAULT: [0.6, 0.25, 0.15],
};

function pickSectionIndex(courseCode, i, sectionCount) {
  const weights = (SECTION_WEIGHTS[courseCode] || SECTION_WEIGHTS.DEFAULT).slice(0, sectionCount);
  const r = (i * 37) % 100 / 100; // deterministic pseudo-random, stable across re-runs
  let acc = 0;
  for (let idx = 0; idx < weights.length; idx++) {
    acc += weights[idx];
    if (r < acc) return idx;
  }
  return weights.length - 1;
}

/** Same bookkeeping the live /api/enrollment/enroll route does - one seat
 *  grab attempt, or a FCFS waitlist join, ordered by queuedAt. */
async function enrollOrWaitlist(student, section, queuedAt) {
  const grabbed = await Section.findOneAndUpdate(
    { _id: section._id, $expr: { $lt: ['$enrolledCount', '$capacity'] } },
    { $inc: { enrolledCount: 1 } },
    { new: true }
  );
  if (grabbed) {
    await Enrollment.create({
      student: student._id,
      section: section._id,
      courseCode: section.courseCode,
      term: section.term,
      status: 'ENROLLED',
      assignedBy: 'STUDENT',
    });
    return 'ENROLLED';
  }
  await Section.updateOne({ _id: section._id }, { $push: { waitlist: { student: student._id, queuedAt } } });
  await Enrollment.create({
    student: student._id,
    section: section._id,
    courseCode: section.courseCode,
    term: section.term,
    status: 'WAITLISTED',
    assignedBy: 'STUDENT',
  });
  return 'WAITLISTED';
}

async function run() {
  const fb = initFirebase();
  await connectDB();

  console.log('[demo-seed] wiping previous demo accounts + enrollments for this term...');
  const demoEmails = [ADMIN.email, ...TEACHERS.map((t) => t.email), ...buildStudents().map((s) => s.email)];
  const previousUsers = await User.find({ email: { $in: demoEmails } });
  await Enrollment.deleteMany({ student: { $in: previousUsers.map((u) => u._id) } });
  await Section.updateMany(
    { term: TERM },
    { $set: { enrolledCount: 0, waitlist: [] } }
  );

  console.log('[demo-seed] creating 1 admin + 5 teachers...');
  await upsertUser(fb, ADMIN);
  for (const t of TEACHERS) await upsertUser(fb, t);

  console.log('[demo-seed] creating 100 students (40 in semester 5, 60 spread across the rest)...');
  const studentDefs = buildStudents();
  const students = [];
  for (const def of studentDefs) {
    const courseHistory = await buildCourseHistory(def.program, def.currentSemester);
    students.push(await upsertUser(fb, def, courseHistory));
  }

  console.log(`[demo-seed] setting current term to "${TERM}" with an open enrollment window...`);
  await Config.findOneAndUpdate({ key: 'currentTerm' }, { value: TERM }, { upsert: true });
  const now = new Date();
  const inOneMonth = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  await Term.findOneAndUpdate(
    { program: PROGRAM, term: TERM },
    { program: PROGRAM, term: TERM, enrollmentStart: now, enrollmentEnd: inOneMonth, creditLimit: 18 },
    { upsert: true }
  );

  console.log('[demo-seed] running the semester-5 registration rush against real section capacities...');
  const SEM5_COURSES = ['CSE 215', 'CSE 216', 'CSE 221', 'CSE 225', 'ENG 112'];
  const sem5Students = students.filter((s) => s.currentSemester === 5).sort((a, b) => a.studentId.localeCompare(b.studentId));

  const tally = {};
  for (const courseCode of SEM5_COURSES) {
    const sections = await Section.find({ courseCode, term: TERM }).sort({ sectionNumber: 1 });
    if (sections.length === 0) continue;
    tally[courseCode] = { ENROLLED: 0, WAITLISTED: 0 };

    for (let i = 0; i < sem5Students.length; i++) {
      const student = sem5Students[i];
      const idx = pickSectionIndex(courseCode, i, sections.length);
      const section = sections[idx];
      const queuedAt = new Date(now.getTime() + i * 60 * 1000); // registration opened, students arrive a minute apart
      const status = await enrollOrWaitlist(student, section, queuedAt);
      tally[courseCode][status]++;
    }
  }

  console.log('\n[demo-seed] registration results (real capacities, no shrinking):');
  for (const [code, counts] of Object.entries(tally)) {
    console.log(`  ${code}: ${counts.ENROLLED} enrolled, ${counts.WAITLISTED} waitlisted`);
  }

  console.log('\n[demo-seed] done. Log in with:');
  console.log(`  Admin:    ${ADMIN.email} / ${DEMO_PASSWORD}`);
  console.log('  Teachers:');
  for (const t of TEACHERS) console.log(`    ${t.email} / ${DEMO_PASSWORD}  (sections taught as "${t.teacherShortCode}")`);
  console.log(`  Students: student1@demo.local ... student100@demo.local / ${DEMO_PASSWORD}`);
  console.log('    student1-student40 are in semester 5 and just went through the registration rush above.');
  console.log('    student41-student100 are spread across semesters 1,2,3,4,6,7,8,9,10,11.');

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error('[demo-seed] failed:', err.message);
  process.exit(1);
});
