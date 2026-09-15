require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Course = require('../models/Course');
const CurriculumSlot = require('../models/CurriculumSlot');
const Section = require('../models/Section');

const courses = require('./courses.data');
const curriculum = require('./curriculum.data');
const sections = require('./sections.data');

async function run() {
  await connectDB();

  console.log('[seed] clearing existing catalog/curriculum/sample-sections...');
  await Course.deleteMany({});
  await CurriculumSlot.deleteMany({});
  await Section.deleteMany({});

  console.log(`[seed] inserting ${courses.length} courses...`);
  await Course.insertMany(courses);

  const slotDocs = [];
  for (const [program, semesters] of Object.entries(curriculum)) {
    for (const [semester, codes] of Object.entries(semesters)) {
      for (const courseCode of codes) {
        slotDocs.push({ program, semester: Number(semester), courseCode, slotType: 'CORE' });
      }
    }
  }
  console.log(`[seed] inserting ${slotDocs.length} curriculum slots...`);
  await CurriculumSlot.insertMany(slotDocs);

  console.log(`[seed] inserting ${sections.length} sample sections...`);
  await Section.insertMany(sections);

  console.log('[seed] done.');
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
