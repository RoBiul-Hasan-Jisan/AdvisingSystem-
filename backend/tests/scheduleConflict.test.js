const test = require('node:test');
const assert = require('node:assert/strict');
const { findConflict } = require('../utils/scheduleConflict');

function enrollment(courseCode, schedule) {
  return { courseCode, section: { schedule } };
}

test('no conflict when there are no existing enrollments', () => {
  const newSchedule = [{ day: 'Sunday', startTime: '10.00', endTime: '11.30' }];
  assert.equal(findConflict(newSchedule, []), null);
});

test('detects a direct overlap on the same day', () => {
  const existing = [enrollment('CSE211', [{ day: 'Sunday', startTime: '10.00', endTime: '11.30' }])];
  const newSchedule = [{ day: 'Sunday', startTime: '10.30', endTime: '12.00' }];
  const conflict = findConflict(newSchedule, existing);
  assert.ok(conflict);
  assert.equal(conflict.courseCode, 'CSE211');
});

test('no conflict on different days even at the same time', () => {
  const existing = [enrollment('CSE211', [{ day: 'Sunday', startTime: '10.00', endTime: '11.30' }])];
  const newSchedule = [{ day: 'Monday', startTime: '10.00', endTime: '11.30' }];
  assert.equal(findConflict(newSchedule, existing), null);
});

test('back-to-back slots (one ends exactly when the other starts) do NOT conflict', () => {
  const existing = [enrollment('CSE211', [{ day: 'Sunday', startTime: '10.00', endTime: '11.30' }])];
  const newSchedule = [{ day: 'Sunday', startTime: '11.30', endTime: '1.00' }];
  assert.equal(findConflict(newSchedule, existing), null);
});

test('correctly treats sub-8 hours as PM (campus day runs 8:30am-6:00pm as one block)', () => {
  // 11.30-1.00 (i.e. 11:30am-1:00pm) followed by 1.30-3.00 (1:30pm-3:00pm) should NOT
  // be misread as 1:30am and flagged as a false conflict with an afternoon slot.
  const existing = [enrollment('CSE211', [{ day: 'Sunday', startTime: '11.30', endTime: '1.00' }])];
  const newSchedule = [{ day: 'Sunday', startTime: '1.30', endTime: '3.00' }];
  assert.equal(findConflict(newSchedule, existing), null);
});

test('catches a real conflict inside the PM block', () => {
  const existing = [enrollment('CSE211', [{ day: 'Sunday', startTime: '1.30', endTime: '3.00' }])];
  const newSchedule = [{ day: 'Sunday', startTime: '2.00', endTime: '3.30' }];
  const conflict = findConflict(newSchedule, existing);
  assert.ok(conflict);
});

test('checks against every existing enrollment, not just the first', () => {
  const existing = [
    enrollment('CSE211', [{ day: 'Sunday', startTime: '10.00', endTime: '11.30' }]),
    enrollment('CSE225', [{ day: 'Monday', startTime: '3.00', endTime: '4.30' }])
  ];
  const newSchedule = [{ day: 'Monday', startTime: '4.00', endTime: '5.30' }];
  const conflict = findConflict(newSchedule, existing);
  assert.equal(conflict.courseCode, 'CSE225');
});

test('a course with multiple weekly slots only needs one of them to clash', () => {
  const existing = [enrollment('CSE211', [
    { day: 'Sunday', startTime: '10.00', endTime: '11.30' },
    { day: 'Tuesday', startTime: '10.00', endTime: '11.30' }
  ])];
  const newSchedule = [{ day: 'Tuesday', startTime: '10.30', endTime: '12.00' }];
  const conflict = findConflict(newSchedule, existing);
  assert.ok(conflict);
  assert.equal(conflict.day, 'Tuesday');
});
