// Which courses are offered in which semester of the CSE program, derived
// from the "CSE Advising Structure - Summer 2026" PDF (11-semester plan).
// Admin can edit this later via PUT /api/courses/curriculum/:program/:semester.
module.exports = {
  CSE: {
    1: ['AA 099', 'AA 150', 'AA 200', 'CSE 111', 'CSE 112'],
    2: ['PHY 101', 'PHY 102', 'CSE 113', 'CSE 114', 'MATH 107', 'ENG 111'],
    3: ['EEE 111', 'EEE 112', 'CSE 211', 'CSE 212', 'MATH 207', 'CHEM 201'],
    4: ['EEE 213', 'EEE 214', 'CSE 123', 'CSE 124', 'CSE 115', 'HUM 201'],
    5: ['CSE 215', 'CSE 216', 'CSE 221', 'CSE 222', 'CSE 225', 'CSE 226', 'ENG 112'],
    6: ['CSE 311', 'CSE 312', 'CSE 313', 'CSE 315', 'CSE 316', 'MATH 205'],
    7: ['CSE 223', 'CSE 224', 'CSE 325', 'CSE 326', 'CSE 242', 'ME 102', 'MATH 203'],
    8: ['CSE 319', 'CSE 320', 'CSE 317', 'CSE 342', 'MATH 301', 'HUM 301'],
    9: ['CSE 321', 'CSE 322', 'CSE 327', 'CSE 328', 'CSE 411', 'CSE 301'],
    10: ['CSE 443', 'CSE 463', 'CSE 439', 'CSE 459', 'CSE 466'],
    11: ['CSE 435', 'CSE 436', 'IPD 400', 'HUM 203'],
  },
};
