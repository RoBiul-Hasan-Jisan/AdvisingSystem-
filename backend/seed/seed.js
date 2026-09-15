require('dotenv').config();
const mongoose = require('mongoose');
const Course = require('../models/Course');
const Semester = require('../models/Semester');
const Config = require('../models/Config');
const courses = require('./courses.json');
const semesterPlan = require('./semesterPlan.json');

const SEED_TERM = 'Summer 2026';

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  await Course.deleteMany({});
  await Course.insertMany(courses);
  console.log(`Seeded ${courses.length} courses`);

  await Semester.deleteMany({});
  const semesterDocs = Object.entries(semesterPlan)
    .filter(([key]) => key !== '_note')
    .map(([number, courseCodes]) => ({
      number: Number(number),
      courseCodes,
      term: SEED_TERM
    }));
  await Semester.insertMany(semesterDocs);
  console.log(`Seeded ${semesterDocs.length} semester plans for ${SEED_TERM}`);

  await Config.findOneAndUpdate({ key: 'currentTerm' }, { value: SEED_TERM }, { upsert: true });
  console.log(`Set current term to ${SEED_TERM}`);
  console.log('Note: this is a one-time bootstrap for the first term. From now on, use the');
  console.log('admin "Import structure" screen to load each new term\'s PDF instead of re-seeding.');

  await mongoose.disconnect();
  console.log('Done.');
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
