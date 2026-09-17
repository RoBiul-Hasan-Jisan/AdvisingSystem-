"""
Parses a university "Advising Structure" PDF — the one that lays out, per
semester, which courses are offered, how many sections, and the seat
capacity of each section — into JSON the backend can import directly as
CurriculumSlot + Section records.

This is the piece that makes the "plan changes every 4 months" requirement
real: instead of hand-editing the curriculum/capacity every term, an admin
uploads the new term's PDF (via POST /api/admin/import/preview) and the
system parses it automatically.

How it finds structure (verified against the real Summer 2026 CSE PDF):
  - The PDF's own Title metadata is "<PROGRAM> Advising Structure - <TERM>"
    (e.g. "CSE Advising Structure - Summer 2026") - that's where program
    and term come from, no guessing needed.
  - Each page has one or more "Semester N" text labels, each sitting
    directly above the section/seat-count table it introduces. Tables are
    matched to the nearest "Semester N" label above them by vertical
    position.
  - Each table cell holds one or more "CODE NNN.section (NN seats)"
    entries (a lab section number can appear more than once across
    columns when it's split into sub-groups with different capacities -
    e.g. "CSE 216.4 (17 seats)" under Section 1's column and
    "CSE 216.4 (7 seats)" under Section 2's - those get summed into one
    section's total capacity, flagged in `notes` for admin review).

Usage:
    pip install pdfplumber --break-system-packages
    python3 parse_advising_pdf.py path/to/AdvisingStructure.pdf > parsed-advising.json
"""
import json
import re
import sys
from collections import defaultdict

import pdfplumber

TITLE_RE = re.compile(r'^(\w+)\s+Advising Structure\s*-\s*(.+)$', re.IGNORECASE)
ENTRY_RE = re.compile(r'([A-Z]{2,4}\s\d{3})\.(\w+)\s*\(\s*(\d+)\s*seats?\s*\)')


def normalize_code(code: str) -> str:
    return re.sub(r'\s+', ' ', code).strip().upper()


def parse_pdf(path):
    warnings = []
    with pdfplumber.open(path) as pdf:
        title = (pdf.metadata or {}).get('Title', '')
        m = TITLE_RE.match(title.strip()) if title else None
        program = m.group(1).upper() if m else None
        term = m.group(2).strip() if m else None
        if not program or not term:
            warnings.append(f'Could not parse program/term from PDF title "{title}" - set them manually.')

        # (semester_number, [ {courseCode, sectionNumber, seats} ]) collected across the whole doc
        by_semester = defaultdict(lambda: defaultdict(list))  # semester -> (course,section) -> [seats,...]

        for page in pdf.pages:
            words = page.extract_words()
            sem_labels = []  # (semester_number:int, top:float)
            for i, w in enumerate(words):
                if w['text'] == 'Semester' and i + 1 < len(words) and words[i + 1]['text'].isdigit():
                    sem_labels.append((int(words[i + 1]['text']), w['top']))
            sem_labels.sort(key=lambda x: x[1])

            tables = page.find_tables()
            for t in sorted(tables, key=lambda t: t.bbox[1]):
                table_top = t.bbox[1]
                # nearest semester label at or above this table
                candidates = [s for s in sem_labels if s[1] <= table_top + 5]
                if not candidates:
                    warnings.append(f'Table at y={table_top:.0f} on a page had no "Semester N" label above it - skipped.')
                    continue
                semester = candidates[-1][0]

                rows = t.extract()
                for row in rows[1:]:  # row 0 is the "Section 1/2/3..." header
                    for cell in row:
                        if not cell:
                            continue
                        for code, section, seats in ENTRY_RE.findall(cell):
                            key = (normalize_code(code), section)
                            by_semester[semester][key].append(int(seats))

        courses_by_semester = {}
        sections = []
        for semester, entries in sorted(by_semester.items()):
            codes = set()
            for (course_code, section_number), seat_list in sorted(entries.items()):
                codes.add(course_code)
                capacity = sum(seat_list)
                note = ''
                if len(seat_list) > 1:
                    note = f'Capacity summed from {len(seat_list)} split sub-groups: {seat_list}'
                sections.append({
                    'courseCode': course_code,
                    'sectionNumber': section_number,
                    'semester': semester,
                    'term': term,
                    'program': program,
                    'capacity': capacity,
                    'note': note,
                })
            courses_by_semester[semester] = sorted(codes)

        return {
            'program': program,
            'term': term,
            'curriculum': courses_by_semester,  # semester -> [courseCode, ...] -> CurriculumSlot rows
            'sections': sections,               # -> Section rows (capacity only; no room/time - that's the routine doc's job)
            'warnings': warnings,
        }


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print('Usage: python3 parse_advising_pdf.py path/to/AdvisingStructure.pdf', file=sys.stderr)
        sys.exit(1)
    print(json.dumps(parse_pdf(sys.argv[1]), indent=2))
