/**
 * Schedule-conflict detection shared between enforcement (enrollment.js,
 * which must run this before ever claiming a seat) and the advisory
 * check-clash endpoint (routines.js, which lets the frontend warn a student
 * before they even click enroll). One implementation, one place to test,
 * rather than two copies that can drift.
 */

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function slotsOverlap(a, b) {
  if (a.day !== b.day) return false;
  return rangesOverlap(timeToMinutes(a.startTime), timeToMinutes(a.endTime), timeToMinutes(b.startTime), timeToMinutes(b.endTime));
}

/**
 * candidateSchedule: [{ day, startTime, endTime }]
 * existingSchedules: [{ courseCode, schedule: [{ day, startTime, endTime }] }]
 * Returns the first conflict found - { courseCode, day, startTime, endTime } -
 * or null if there's no overlap with anything in existingSchedules.
 */
function findConflict(candidateSchedule, existingSchedules) {
  for (const slot of candidateSchedule || []) {
    for (const existing of existingSchedules || []) {
      for (const existingSlot of existing.schedule || []) {
        if (slotsOverlap(slot, existingSlot)) {
          return { courseCode: existing.courseCode, day: existingSlot.day, startTime: existingSlot.startTime, endTime: existingSlot.endTime };
        }
      }
    }
  }
  return null;
}

/**
 * Same idea but checks a whole set of candidate sections pairwise against
 * each other (used by the /check-clash endpoint when a student is
 * evaluating several picks at once before enrolling in any of them).
 * sections: [{ courseCode, schedule }]
 * Returns every pairwise clash found, not just the first.
 */
function findAllConflicts(sections) {
  const clashes = [];
  for (let i = 0; i < sections.length; i++) {
    for (let j = i + 1; j < sections.length; j++) {
      const conflict = findConflict(sections[i].schedule, [sections[j]]);
      if (conflict) {
        clashes.push({ courseA: sections[i].courseCode, courseB: sections[j].courseCode, day: conflict.day });
      }
    }
  }
  return clashes;
}

module.exports = { findConflict, findAllConflicts, timeToMinutes, slotsOverlap };
