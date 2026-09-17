const test = require('node:test');
const assert = require('node:assert/strict');
const { findConflict, findAllConflicts } = require('../src/utils/scheduleConflict');

function existing(courseCode, schedule) {
  return { courseCode, schedule };
}

test('no conflict when there are no existing schedules', () => {
  const candidate = [{ day: 'SUN', startTime: '10:00', endTime: '11:30' }];
  assert.equal(findConflict(candidate, []), null);
});

test('detects a direct overlap on the same day', () => {
  const existingSchedules = [existing('CSE 211', [{ day: 'SUN', startTime: '10:00', endTime: '11:30' }])];
  const candidate = [{ day: 'SUN', startTime: '10:30', endTime: '12:00' }];
  const conflict = findConflict(candidate, existingSchedules);
  assert.ok(conflict);
  assert.equal(conflict.courseCode, 'CSE 211');
});

test('no conflict on different days even at the same time', () => {
  const existingSchedules = [existing('CSE 211', [{ day: 'SUN', startTime: '10:00', endTime: '11:30' }])];
  const candidate = [{ day: 'MON', startTime: '10:00', endTime: '11:30' }];
  assert.equal(findConflict(candidate, existingSchedules), null);
});

test('back-to-back slots (one ends exactly when the other starts) do NOT conflict', () => {
  const existingSchedules = [existing('CSE 211', [{ day: 'SUN', startTime: '10:00', endTime: '11:30' }])];
  const candidate = [{ day: 'SUN', startTime: '11:30', endTime: '13:00' }];
  assert.equal(findConflict(candidate, existingSchedules), null);
});

test('catches a real conflict in the afternoon', () => {
  const existingSchedules = [existing('CSE 211', [{ day: 'SUN', startTime: '13:30', endTime: '15:00' }])];
  const candidate = [{ day: 'SUN', startTime: '14:00', endTime: '15:30' }];
  const conflict = findConflict(candidate, existingSchedules);
  assert.ok(conflict);
});

test('checks against every existing schedule, not just the first', () => {
  const existingSchedules = [
    existing('CSE 211', [{ day: 'SUN', startTime: '10:00', endTime: '11:30' }]),
    existing('CSE 225', [{ day: 'MON', startTime: '15:00', endTime: '16:30' }]),
  ];
  const candidate = [{ day: 'MON', startTime: '16:00', endTime: '17:30' }];
  const conflict = findConflict(candidate, existingSchedules);
  assert.equal(conflict.courseCode, 'CSE 225');
});

test('a course with multiple weekly slots only needs one of them to clash', () => {
  const existingSchedules = [
    existing('CSE 211', [
      { day: 'SUN', startTime: '10:00', endTime: '11:30' },
      { day: 'TUE', startTime: '10:00', endTime: '11:30' },
    ]),
  ];
  const candidate = [{ day: 'TUE', startTime: '10:30', endTime: '12:00' }];
  const conflict = findConflict(candidate, existingSchedules);
  assert.ok(conflict);
  assert.equal(conflict.day, 'TUE');
});

test('findAllConflicts finds every pairwise clash across a set of sections', () => {
  const sections = [
    { courseCode: 'CSE 215', schedule: [{ day: 'TUE', startTime: '13:30', endTime: '15:30' }] },
    { courseCode: 'CSE 221', schedule: [{ day: 'TUE', startTime: '14:00', endTime: '15:00' }] },
    { courseCode: 'CSE 225', schedule: [{ day: 'THU', startTime: '11:30', endTime: '13:00' }] },
  ];
  const clashes = findAllConflicts(sections);
  assert.equal(clashes.length, 1);
  assert.deepEqual([clashes[0].courseA, clashes[0].courseB].sort(), ['CSE 215', 'CSE 221']);
});

test('findAllConflicts returns nothing for a clash-free set', () => {
  const sections = [
    { courseCode: 'CSE 215', schedule: [{ day: 'TUE', startTime: '13:30', endTime: '15:30' }] },
    { courseCode: 'CSE 225', schedule: [{ day: 'THU', startTime: '11:30', endTime: '13:00' }] },
  ];
  assert.deepEqual(findAllConflicts(sections), []);
});
