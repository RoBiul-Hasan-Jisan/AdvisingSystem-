// Campus day runs 8:30am - 6:00pm as a single continuous block (see the
// Summer 2026 routine: 8.30-10.00, 10.00-11.30, 11.30-1.00, 1.30-3.00,
// 3.00-4.30, 4.30-6.00). Hours below 8 are therefore always PM slots that
// follow the 11.30-1.00 period, so we add 12 to disambiguate them.
function toMinutes(timeStr) {
  const [hStr, mStr] = timeStr.split('.');
  let h = Number(hStr);
  const m = Number(mStr);
  if (h < 8) h += 12;
  return h * 60 + m;
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Returns the first conflicting { courseCode, day, startTime, endTime }
 * from existingSchedules, or null if newSchedule has no overlap with any
 * of them. Both are arrays of { day, startTime, endTime, room }.
 */
function findConflict(newSchedule, existingEnrollments) {
  for (const slot of newSchedule || []) {
    const newStart = toMinutes(slot.startTime);
    const newEnd = toMinutes(slot.endTime);

    for (const enrollment of existingEnrollments) {
      for (const existingSlot of (enrollment.section?.schedule || [])) {
        if (existingSlot.day !== slot.day) continue;
        const exStart = toMinutes(existingSlot.startTime);
        const exEnd = toMinutes(existingSlot.endTime);
        if (rangesOverlap(newStart, newEnd, exStart, exEnd)) {
          return {
            courseCode: enrollment.courseCode,
            day: existingSlot.day,
            startTime: existingSlot.startTime,
            endTime: existingSlot.endTime
          };
        }
      }
    }
  }
  return null;
}

module.exports = { toMinutes, rangesOverlap, findConflict };
