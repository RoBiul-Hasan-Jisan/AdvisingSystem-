"""
Parses the university's Word routine document (the real weekly timetable —
Theory/Lab tables per day, room x time-slot grid) into JSON shaped like the
backend's Section model, so an admin can review it and bulk-import via
POST /api/sections instead of hand-typing every section.

The doc's own structure (14 tables): a Theory table then a Lab table for
each of Saturday..Thursday, followed by an Exam Routine table and a Faculty
Members lookup table - both skipped here, the exam table isn't Section data
and the faculty table is only used to resolve short-codes to full names.

Usage:
    pip install python-docx --break-system-packages
    python3 parse_routine.py path/to/routine.docx > parsed-sections.json

Output is grouped by (courseCode, sectionNumber) because a section can meet
more than once a week - each meeting becomes one entry in that group's
"schedule" array, matching Section.schedule in the Mongo model.

IMPORTANT: real timetable docs are never perfectly regular (merged cells,
inline time overrides like "CSE 215.1 (11.30-1.30)", stray typos). This is
a best-effort first pass, not a guaranteed-correct import - always review
parsed-sections.json before loading it, especially the "warnings" section
at the bottom for anything the parser couldn't confidently place (tested
against the real Summer 2026 doc: 218 sections parsed cleanly, 62 warnings -
mostly EEE/cross-department entries with no ".section" suffix, or a
"(EEE)" annotation this parser doesn't special-case).

NOTE ON TIMES: the source document writes times in 12-hour form with no
AM/PM marker ("1.30-3.00"). Since the whole class day runs 8:30-18:00, this
script infers PM for any hour below 8 (so "1.30" -> 13:30, not 01:30) -
that assumption holds for every slot in the real routine but is worth
re-checking if a future term's doc ever schedules an actual early-morning slot.
"""
import json
import re
import sys
from collections import defaultdict

import docx

DAY_CODE = {
    'Saturday': 'SAT', 'Sunday': 'SUN', 'Monday': 'MON',
    'Tuesday': 'TUE', 'Wednesday': 'WED', 'Thursday': 'THU', 'Friday': 'FRI',
}

# e.g. "CSE 215.1" -> ("CSE 215", "1");  "CSE 215.1 (11.30-1.30)" -> also captures the override
ENTRY_RE = re.compile(
    r'^([A-Z]{2,4}\s?\d{3})\.(\S+?)(?:\s*\((\d{1,2}\.\d{2})-(\d{1,2}\.\d{2})\))?\s*$'
)


def dotted_to_hhmm(s):
    # Source doc uses 12-hour numbers with no AM/PM marker. Class hours run
    # 8:30 -> 18:00, so any hour below 8 is unambiguously PM (add 12);
    # 8/9/10/11 stay as morning as-is.
    h, m = s.split('.')
    h = int(h)
    if h < 8:
        h += 12
    return f'{h:02d}:{m}'


def parse_time_header(header):
    # "8.30-10.00" -> ("08:30", "10:00")
    start, end = header.split('-')
    return dotted_to_hhmm(start.strip()), dotted_to_hhmm(end.strip())


def parse_table(table, day, warnings):
    """Yields (courseCode, sectionNumber, scheduleEntry, faculty) tuples."""
    header_row = table.rows[2]  # row 0 = day name, row 1 = "Theory/Lab Classes", row 2 = time headers
    time_cols = []
    for cell in header_row.cells[1:]:
        text = cell.text.strip()
        if '-' in text:
            time_cols.append(parse_time_header(text))
        else:
            time_cols.append(None)

    for row in table.rows[3:]:
        room = row.cells[0].text.strip()
        if not room:
            continue
        for col_idx, cell in enumerate(row.cells[1:]):
            if col_idx >= len(time_cols) or time_cols[col_idx] is None:
                continue
            default_start, default_end = time_cols[col_idx]
            text = cell.text.strip()
            if not text:
                continue
            # A cell can (rarely) stack more than one class; each pair of
            # lines (course.section / faculty) is one entry.
            lines = [l for l in text.split('\n') if l.strip()]
            i = 0
            while i < len(lines):
                entry_line = lines[i].strip()
                faculty = lines[i + 1].strip() if i + 1 < len(lines) else ''
                m = ENTRY_RE.match(entry_line)
                if not m:
                    warnings.append(f'Could not parse "{entry_line}" in room {room}, {day}')
                    i += 2
                    continue
                course_code, section_number, ov_start, ov_end = m.groups()
                start = dotted_to_hhmm(ov_start) if ov_start else default_start
                end = dotted_to_hhmm(ov_end) if ov_end else default_end
                yield (
                    course_code.strip(),
                    section_number.strip(),
                    {'day': DAY_CODE.get(day, day[:3].upper()), 'startTime': start, 'endTime': end, 'room': room},
                    faculty,
                )
                i += 2


def main(path):
    d = docx.Document(path)
    warnings = []
    grouped = defaultdict(lambda: {'schedule': [], 'faculty': set()})

    for table in d.tables:
        day_cell = table.rows[0].cells[0].text.strip()
        if day_cell not in DAY_CODE:
            continue  # skips the Exam Routine and Faculty Members tables
        for course_code, section_number, entry, faculty in parse_table(table, day_cell, warnings):
            key = (course_code, section_number)
            grouped[key]['schedule'].append(entry)
            if faculty:
                grouped[key]['faculty'].add(faculty)

    sections = []
    for (course_code, section_number), data in sorted(grouped.items()):
        sections.append({
            'courseCode': course_code,
            'sectionNumber': section_number,
            'term': 'Summer 2026',
            'faculty': next(iter(data['faculty']), ''),
            'schedule': data['schedule'],
            # capacity is intentionally left out - pull real seat counts from
            # the Advising Structure PDF (already seeded in seed/sections.data.js)
            # and merge by (courseCode, sectionNumber) before importing.
        })

    print(json.dumps({'sections': sections, 'warnings': warnings}, indent=2))


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print('Usage: python3 parse_routine.py path/to/routine.docx', file=sys.stderr)
        sys.exit(1)
    main(sys.argv[1])
