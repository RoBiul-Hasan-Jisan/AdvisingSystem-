const mongoose = require('mongoose');

const courseSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true }, // e.g. "CSE221"
  title: { type: String, required: true },
  credits: { type: Number, required: true },
  category: { type: String, required: true }, // Access Academy | Language Skill | University Program | Basic Science | Mathematics | Interdisciplinary | Program Core | Options
  prerequisites: [{ type: String, uppercase: true }], // array of course codes
  active: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Course', courseSchema);
