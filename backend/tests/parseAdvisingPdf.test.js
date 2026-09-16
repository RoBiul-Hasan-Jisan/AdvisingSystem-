const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAdvisingText } = require('../utils/parseAdvisingPdf');

test('parses a single section token under a semester heading', () => {
  const text = 'Semester 1 PHY 101.1 (30 seats)';
  const { records, semesterCourseMap, warnings } = parseAdvisingText(text);

  assert.equal(records.length, 1);
  assert.deepEqual(records[0], { courseCode: 'PHY101', sectionLabel: '1', semesterNumber: 1, capacity: 30 });
  assert.deepEqual(semesterCourseMap['1'], ['PHY101']);
  assert.equal(warnings.length, 0);
});

test('attributes tokens to the nearest PRECEDING semester heading, not the next one', () => {
  const text = 'Semester 1 CSE 111.1 (30 seats) Semester 2 AA 099.1 (30 seats)';
  const { records } = parseAdvisingText(text);

  const cse = records.find(r => r.courseCode === 'CSE111');
  const aa = records.find(r => r.courseCode === 'AA099');
  assert.equal(cse.semesterNumber, 1);
  assert.equal(aa.semesterNumber, 2);
});

test('handles multiple sections of the same course on one line', () => {
  const text = 'Semester 3 CSE 211.1 (31 seats) CSE 211.2 (31 seats) CSE 211.3 (31 seats)';
  const { records, semesterCourseMap } = parseAdvisingText(text);

  assert.equal(records.length, 3);
  assert.deepEqual(records.map(r => r.sectionLabel), ['1', '2', '3']);
  // same course code, so the semester's course list should de-duplicate to one entry
  assert.deepEqual(semesterCourseMap['3'], ['CSE211']);
});

test('tolerates the line-wrap typo "(NUM\\nseats)"', () => {
  const text = 'Semester 4 CSE 322.10 (10\nseats)';
  const { records, warnings } = parseAdvisingText(text);
  assert.equal(records.length, 1);
  assert.equal(records[0].capacity, 10);
  assert.equal(records[0].sectionLabel, '10');
  assert.equal(warnings.length, 0);
});

test('tolerates the stray-paren typo "(NUM) seats)"', () => {
  const text = 'Semester 11 CSE 466.1 (26) seats)';
  const { records } = parseAdvisingText(text);
  assert.equal(records.length, 1);
  assert.equal(records[0].capacity, 26);
});

test('warns instead of throwing when a token appears before any semester heading', () => {
  const text = 'CSE 111.1 (30 seats) Semester 1 CSE 112.1 (30 seats)';
  const { records, warnings } = parseAdvisingText(text);
  assert.equal(records.length, 1); // only the one after the heading is kept
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /no "Semester N" heading/i);
});

test('warns when there are no semester headings at all', () => {
  const { warnings, records } = parseAdvisingText('some unrelated PDF text with no structure');
  assert.equal(records.length, 0);
  assert.equal(warnings.length, 1);
});

test('ignores non-matching text (e.g. "Section 1 Section 2" header rows)', () => {
  const text = 'Semester 1 Section 1 Section 2 Section 3 Section 4 PHY 101.1 (30 seats)';
  const { records } = parseAdvisingText(text);
  assert.equal(records.length, 1);
});

test('semesterCourseMap groups and sorts course codes alphabetically', () => {
  const text = 'Semester 6 CSE 226.1 (30 seats) CSE 216.1 (30 seats) CSE 221.1 (30 seats)';
  const { semesterCourseMap } = parseAdvisingText(text);
  assert.deepEqual(semesterCourseMap['6'], ['CSE216', 'CSE221', 'CSE226']);
});
