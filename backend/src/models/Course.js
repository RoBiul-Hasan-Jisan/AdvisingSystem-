const mongoose = require('mongoose');

/**
 * Master catalog entry. This is program-agnostic: the same course (e.g. MATH 207)
 * can be pulled into more than one program's curriculum (see CurriculumSlot).
 */
const courseSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true }, // "CSE 221"
    title: { type: String, required: true, trim: true },
    credits: { type: Number, required: true },
    category: {
      type: String,
      enum: [
        'ACCESS_ACADEMY',
        'LANGUAGE',
        'UNIVERSITY_PROGRAM',
        'BASIC_SCIENCE',
        'MATHEMATICS',
        'INTERDISCIPLINARY',
        'PROGRAM_CORE',
        'OPTION',
      ],
      required: true,
    },
    // Prerequisite course codes. Empty array = no prerequisite.
    prerequisites: [{ type: String, uppercase: true, trim: true }],
    // If this is a lab paired with a theory course (e.g. CSE 212 labs CSE 211), link it.
    labOf: { type: String, uppercase: true, trim: true, default: null },
    isLab: { type: Boolean, default: false },
  },
  { timestamps: true }
);

courseSchema.index({ code: 1 });

module.exports = mongoose.model('Course', courseSchema);
