// Real seat counts come from "CSE Advising Structure - Summer 2026" (Semester 5 block).
// Real rooms/faculty short-codes come from the Summer 2026 routine docx.
// This is a representative slice, not the full timetable - use POST /api/sections
// (or a follow-up import script) to load the rest.
const TERM = 'Summer 2026';

module.exports = [
  { courseCode: 'CSE 215', sectionNumber: '1', term: TERM, program: 'CSE', capacity: 35, faculty: 'PH',
    schedule: [{ day: 'TUE', startTime: '13:30', endTime: '15:30', room: '110' }] },
  { courseCode: 'CSE 215', sectionNumber: '2', term: TERM, program: 'CSE', capacity: 35, faculty: 'PH',
    schedule: [{ day: 'TUE', startTime: '11:30', endTime: '13:30', room: '111' }] },
  { courseCode: 'CSE 215', sectionNumber: '3', term: TERM, program: 'CSE', capacity: 35, faculty: 'ANJ',
    schedule: [{ day: 'TUE', startTime: '15:30', endTime: '17:30', room: 'N203' }] },

  { courseCode: 'CSE 221', sectionNumber: '1', term: TERM, program: 'CSE', capacity: 35, faculty: 'SAH',
    schedule: [{ day: 'TUE', startTime: '11:30', endTime: '13:00', room: '110' }] },
  { courseCode: 'CSE 221', sectionNumber: '2', term: TERM, program: 'CSE', capacity: 35, faculty: 'SAH',
    schedule: [{ day: 'TUE', startTime: '10:00', endTime: '11:30', room: '111' }] },
  { courseCode: 'CSE 221', sectionNumber: '3', term: TERM, program: 'CSE', capacity: 35, faculty: 'SAH',
    schedule: [{ day: 'TUE', startTime: '13:30', endTime: '15:00', room: '111' }] },

  { courseCode: 'CSE 225', sectionNumber: '1', term: TERM, program: 'CSE', capacity: 35, faculty: 'JUD',
    schedule: [{ day: 'TUE', startTime: '10:00', endTime: '11:30', room: '110' }] },
  { courseCode: 'CSE 225', sectionNumber: '2', term: TERM, program: 'CSE', capacity: 35, faculty: 'JUD',
    schedule: [{ day: 'TUE', startTime: '08:30', endTime: '10:00', room: '111' }] },
  { courseCode: 'CSE 225', sectionNumber: '3', term: TERM, program: 'CSE', capacity: 35, faculty: 'JUD',
    schedule: [{ day: 'THU', startTime: '11:30', endTime: '13:00', room: '114' }] },

  { courseCode: 'CSE 216', sectionNumber: '1', term: TERM, program: 'CSE', capacity: 18, faculty: 'PH',
    schedule: [{ day: 'THU', startTime: '09:30', endTime: '11:30', room: '105' }] },
  { courseCode: 'CSE 216', sectionNumber: '2', term: TERM, program: 'CSE', capacity: 21, faculty: 'PH',
    schedule: [{ day: 'WED', startTime: '13:30', endTime: '15:30', room: '106' }] },
  { courseCode: 'CSE 216', sectionNumber: '3', term: TERM, program: 'CSE', capacity: 21, faculty: 'ANJ',
    schedule: [{ day: 'THU', startTime: '15:30', endTime: '17:30', room: '106' }] },

  { courseCode: 'ENG 112', sectionNumber: '1', term: TERM, program: 'CSE', capacity: 18, faculty: 'PRM',
    schedule: [{ day: 'WED', startTime: '13:30', endTime: '15:30', room: '102' }] },
  { courseCode: 'ENG 112', sectionNumber: '2', term: TERM, program: 'CSE', capacity: 21, faculty: 'PRM',
    schedule: [{ day: 'MON', startTime: '15:30', endTime: '17:30', room: '115' }] },
  { courseCode: 'ENG 112', sectionNumber: '3', term: TERM, program: 'CSE', capacity: 21, faculty: 'PRM',
    schedule: [{ day: 'WED', startTime: '11:30', endTime: '13:30', room: '115' }] },
];
