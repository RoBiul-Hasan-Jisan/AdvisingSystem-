/**
 * Parses the raw text of an "advising structure" PDF (the kind that lists,
 * per semester, each course's sections and their seat counts, e.g.
 * "CSE 113.1 (30 seats)") into structured records.
 *
 * The source PDFs from the registrar follow this pattern throughout:
 *   ... "Semester 3" ...
 *   ... "CSE 211.1 (31 seats) CSE 211.2 (31 seats) ..." ...
 * i.e. a "Semester N" heading, followed (anywhere later in the document,
 * across lines/columns) by one or more "<CODE> <NUM>.<SECTION> (<SEATS>
 * seats)" tokens that belong to that semester, until the next heading.
 *
 * This is regex-based rather than a strict table parser because PDF text
 * extraction frequently reflows multi-column tables into a single stream -
 * scanning for these two token shapes in document order is far more robust
 * to that reflow than trying to reconstruct rows/columns.
 */

const SEMESTER_HEADING = /Semester\s+(\d{1,2})/gi;
// The trailing `\)?` before "seats" tolerates a stray extra paren some
// source PDFs contain as a typo, e.g. "(26) seats)" instead of "(26 seats)".
const SECTION_TOKEN = /([A-Z]{2,5})\s?(\d{3})\.(\d{1,2})\s*\(\s*(\d{1,3})\s*\)?\s*seats?\s*\)/gi;

function parseAdvisingText(rawText) {
  // Normalize whitespace/newlines so a token split across a line wrap
  // (e.g. "(10\nseats)") still matches.
  const text = rawText.replace(/\s+/g, ' ');

  const semesterMarkers = [];
  let m;
  while ((m = SEMESTER_HEADING.exec(text))) {
    semesterMarkers.push({ index: m.index, number: Number(m[1]) });
  }

  const records = [];
  const warnings = [];

  while ((m = SECTION_TOKEN.exec(text))) {
    const matchIndex = m.index;

    // the semester this token belongs to = the last heading seen before it
    let semesterNumber = null;
    for (let i = semesterMarkers.length - 1; i >= 0; i--) {
      if (semesterMarkers[i].index <= matchIndex) {
        semesterNumber = semesterMarkers[i].number;
        break;
      }
    }

    if (semesterNumber === null) {
      warnings.push(`Skipped "${m[0].trim()}" — no "Semester N" heading found before it in the document.`);
      continue;
    }

    records.push({
      courseCode: `${m[1].toUpperCase()}${m[2]}`,
      sectionLabel: m[3],
      semesterNumber,
      capacity: Number(m[4])
    });
  }

  if (semesterMarkers.length === 0) {
    warnings.push('No "Semester N" headings were found at all — check this is the right PDF format.');
  }

  // group into { "3": ["CSE211", "CSE212", ...], ... } for the Semester plan
  const semesterCourseMap = {};
  for (const r of records) {
    const key = String(r.semesterNumber);
    if (!semesterCourseMap[key]) semesterCourseMap[key] = new Set();
    semesterCourseMap[key].add(r.courseCode);
  }
  for (const key of Object.keys(semesterCourseMap)) {
    semesterCourseMap[key] = Array.from(semesterCourseMap[key]).sort();
  }

  return { records, semesterCourseMap, warnings };
}

module.exports = { parseAdvisingText };
