require('dotenv').config();
const mongoose = require('mongoose');
const Course = require('../models/Course');
const Semester = require('../models/Semester');
const courses = require('./courses.json');
const semesterPlan = require('./semesterPlan.json');

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
      term: 'Summer 2026'
    }));
  await Semester.insertMany(semesterDocs);
  console.log(`Seeded ${semesterDocs.length} semester plans`);

  await mongoose.disconnect();
  console.log('Done.');
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
