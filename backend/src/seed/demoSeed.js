// Run after `npm run seed` and `npm run bootstrap-admin`. Creates a demo
// teacher and two demo students with real Firebase logins, sets the active
// term + enrollment window, and puts one student through an actual
// enrollment (and the other onto a waitlist behind them) so the system
// isn't an empty shell on first login - there's something on the dashboard,
// the routine page, the roster, and the waitlist position to actually see.
//
// Usage: node src/seed/demoSeed.js
// (all emails/passwords are fixed demo values - printed at the end)
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const initFirebase = require('../config/firebase');
const User = require('../models/User');
const Section = require('../models/Section');
const Config = require('../models/Config');
const Term = require('../models/Term');
const Enrollment = require('../models/Enrollment');

const TERM = 'Summer 2026';
const DEMO_PASSWORD = 'Demo1234!';

const DEMO_ACCOUNTS = [
  { role: 'teacher', name: 'Demo Teacher', email: 'teacher@demo.local', teacherShortCode: 'SAH' },
  { role: 'student', name: 'Demo Student One', email: 'student1@demo.local', studentId: 'CSE2201', program: 'CSE', currentSemester: 5 },
  { role: 'student', name: 'Demo Student Two', email: 'student2@demo.local', studentId: 'CSE2202', program: 'CSE', currentSemester: 5 },
];

async function upsertFirebaseAndMongoUser(fb, account) {
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

  const doc = {
    firebaseUid: firebaseUser.uid,
    name: account.name,
    email: account.email,
    role: account.role,
  };
  if (account.role === 'teacher') doc.teacherShortCode = account.teacherShortCode;
  if (account.role === 'student') {
    doc.studentId = account.studentId;
    doc.program = account.program;
    doc.currentSemester = account.currentSemester;
  }

  return User.findOneAndUpdate({ firebaseUid: firebaseUser.uid }, doc, { upsert: true, new: true });
}

async function run() {
  const fb = initFirebase();
  await connectDB();

  console.log('[demo-seed] creating demo accounts...');
  const users = {};
  for (const account of DEMO_ACCOUNTS) {
    const user = await upsertFirebaseAndMongoUser(fb, account);
    users[account.email] = user;
    console.log(`[demo-seed] ready: ${account.role} - ${account.email}`);
  }

  console.log(`[demo-seed] setting current term to "${TERM}"...`);
  await Config.findOneAndUpdate({ key: 'currentTerm' }, { value: TERM }, { upsert: true });

  console.log('[demo-seed] opening an enrollment window for CSE...');
  const now = new Date();
  const inOneMonth = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  await Term.findOneAndUpdate(
    { program: 'CSE', term: TERM },
    { program: 'CSE', term: TERM, enrollmentStart: now, enrollmentEnd: inOneMonth, creditLimit: 18 },
    { upsert: true }
  );

  // Give the two demo students a real enrollment scenario: both students go
  // for the same section of a small-capacity course; the seed data's
  // ENG 112 sections have small caps (18-21 seats), which is realistic but
  // too large to demo a waitlist with two students - instead we shrink one
  // real seeded section down to capacity 1 here, purely for the demo, so
  // student two visibly lands on the waitlist behind student one.
  const demoSection = await Section.findOne({ courseCode: 'CSE 215', sectionNumber: '1', term: TERM });
  if (demoSection) {
    demoSection.capacity = 1;
    demoSection.enrolledCount = 0;
    demoSection.waitlist = [];
    await demoSection.save();

    const s1 = users['student1@demo.local'];
    const s2 = users['student2@demo.local'];

    await Enrollment.deleteMany({ section: demoSection._id });

    await Section.updateOne({ _id: demoSection._id }, { $inc: { enrolledCount: 1 } });
    await Enrollment.create({
      student: s1._id,
      section: demoSection._id,
      courseCode: demoSection.courseCode,
      term: TERM,
      status: 'ENROLLED',
      assignedBy: 'STUDENT',
    });

    const queuedAt = new Date();
    await Section.updateOne({ _id: demoSection._id }, { $push: { waitlist: { student: s2._id, queuedAt } } });
    await Enrollment.create({
      student: s2._id,
      section: demoSection._id,
      courseCode: demoSection.courseCode,
      term: TERM,
      status: 'WAITLISTED',
      assignedBy: 'STUDENT',
    });

    console.log('[demo-seed] Student One is ENROLLED in CSE 215 Section 1; Student Two is WAITLISTED behind them.');
  } else {
    console.log('[demo-seed] (skipped the enrollment demo - run `npm run seed` first so CSE 215 Section 1 exists)');
  }

  console.log('\n[demo-seed] done. Log in with:');
  console.log('  Admin:    use the account you created with `npm run bootstrap-admin`');
  console.log(`  Teacher:  teacher@demo.local / ${DEMO_PASSWORD}`);
  console.log(`  Student:  student1@demo.local / ${DEMO_PASSWORD}  (enrolled in CSE 215)`);
  console.log(`  Student:  student2@demo.local / ${DEMO_PASSWORD}  (waitlisted for CSE 215)`);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error('[demo-seed] failed:', err.message);
  process.exit(1);
});
