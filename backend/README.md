# University Advising & Registration System — Backend

Stack: **Node/Express** (this repo) · **MongoDB** · **Firebase Auth** — frontend lives in `../frontend`.

## What's here (Phase 1 + Phase 2)

- Full course catalog with prerequisites (seeded from the real 166-credit CSE catalog)
- Which courses each of the 11 semesters offers ("curriculum slots") — admin-editable
- Sections with capacity, schedule, and faculty (seeded with real sample data; admin/teacher
  can add more via the API, or bulk-import via `scripts/parse_routine.py`)
- **Atomic, race-condition-safe, first-come-first-served enrollment** with automatic waitlisting
  and a live **waitlist position** ("you're #3 in line")
- **Enrollment windows** per program/term — enroll requests outside the window are rejected
- **Credit-limit and schedule-clash checks enforced at enroll time**, not just advisory
- Auto-generated **regular routine** per student (from their program + current semester)
- **Custom routine** support for a student taking an extra/retake course
- Teacher self-service: `GET /api/sections/mine`, roster view, drop a no-show
- Admin: add/remove students, record results, promote students to the next semester,
  force-assign a student into a section, set enrollment windows/credit limits
- Firebase-token auth with role gating (student / teacher / admin)

## Why these design choices

**Seat allocation (the trickiest real-world part).** Two students clicking "enroll" on the
last open seat at the same millisecond must not both get in. Rather than a manual lock or a
polling queue, `Section.enrolledCount` and `Section.capacity` live on the same document and
the grab is one atomic `findOneAndUpdate({ enrolledCount: { $lt: capacity } }, { $inc: { enrolledCount: 1 } })`.
MongoDB guarantees only one of two concurrent requests can match — the loser is transparently
routed to a `waitlist` array ordered by `queuedAt`, so it's genuinely FCFS. When someone drops,
the earliest waitlisted student is auto-promoted into the freed seat. See `src/routes/enrollment.js`.

**Enroll-time checks run in a fixed order** (window → prerequisites → duplicate → credit limit →
schedule clash → seat grab) so a student always gets the *first* reason their enrollment failed,
not a generic error, and each check is a separate small function you can unit test on its own.

**Routine vs. Section vs. Enrollment are three different documents**, not one, because they
answer three different questions:
- *Routine* — "what courses should this student see this term?" (regular, or custom)
- *Section* — "what specific offerings of a course exist, and how many seats are left?"
- *Enrollment* — "which student is actually sitting in which section?" (the audit trail)

**Promotion is a deliberate, explicit admin action** (`POST /api/admin/promote`), not automatic
on result entry — results get recorded first (`POST /api/admin/results`), admin reviews, then
promotes a student or a whole batch. Keeps a human in the loop on something as consequential
as semester promotion, while still letting admin "do anything."

## Data model
```
Course            code, title, credits, category, prerequisites[], labOf
CurriculumSlot    program, semester, courseCode, slotType   (the 11-semester map)
Section           courseCode, sectionNumber, term, capacity, enrolledCount, schedule[], waitlist[]
Term              program, term, enrollmentStart/End, creditLimit
User              firebaseUid, role, program, currentSemester, courseHistory[], status
Enrollment        student, section, courseCode, term, status, enrolledAt   (FCFS ledger)
Routine           student, term, type(REGULAR|CUSTOM), courseCodes[]
```

## Running it
```bash
cd backend
npm install
cp .env.example .env        # fill in MONGODB_URI and Firebase service account
npm run seed                # loads real course catalog + curriculum + sample sections
npm run dev
```

Per student/teacher/admin: create their Firebase Auth account (frontend sign-up or Firebase
console), then `POST /api/admin/students` to link that `firebaseUid` to a Mongo user with the
right role. To let a teacher see their own sections via `GET /api/sections/mine`, set their
`teacherShortCode` (via `PATCH /api/admin/students/:id`) to match the faculty code used in
`Section.faculty` (e.g. "SAH", "JUD" — see the routine doc's faculty list).

## Importing the real routine (optional, replaces the seed's sample slice)
```bash
pip install python-docx --break-system-packages
python3 scripts/parse_routine.py path/to/routine.docx > scripts/parsed-sections.json
```
Parses every Theory/Lab table in the Word routine doc into `Section.schedule`-shaped JSON,
grouped by (courseCode, sectionNumber) since a section can meet more than once a week. Tested
against the real Summer 2026 doc: 218 sections parsed, 62 flagged as warnings (mostly
cross-department entries without a ".section" suffix) — always review the `warnings` array
and merge real seat counts from the Advising Structure PDF (capacity isn't in the routine doc)
before bulk-importing via `POST /api/sections`. See the script's docstring for the time-format
assumption it makes.

## API surface
| Method | Path | Who | What |
|---|---|---|---|
| GET | /api/courses | any auth'd user | full catalog |
| GET | /api/courses/curriculum/:program | any | 11-semester plan |
| POST/PATCH/DELETE | /api/courses... | admin | edit catalog/curriculum |
| GET | /api/sections?course=&term= | any | sections + seats left |
| GET | /api/sections/mine | teacher | this teacher's own sections |
| POST | /api/sections | admin/teacher | open a section |
| PATCH | /api/sections/:id | admin/teacher | capacity/schedule/close |
| GET | /api/sections/:id/roster | admin/teacher | who's enrolled |
| GET | /api/routines/me?term= | student | their routine + pickable sections |
| POST | /api/routines/custom | admin | one-off routine for a student |
| POST | /api/routines/check-clash | any | schedule-overlap check (advisory, pre-confirm) |
| GET | /api/terms?term=&program= | any | enrollment windows + credit limits |
| PUT | /api/terms/:program/:term | admin | set an enrollment window / credit limit |
| POST | /api/enrollment/enroll | student | pick a section (window+credit+clash checked, FCFS) |
| POST | /api/enrollment/drop | student/staff | drop, auto-promotes waitlist |
| GET | /api/enrollment/me?term= | student | their enrollment + live waitlist position |
| POST | /api/enrollment/admin-assign | admin/teacher | force-place a student |
| GET | /api/admin/students | admin | list/filter students |
| POST/PATCH/DELETE | /api/admin/students... | admin | manage students |
| POST | /api/admin/results | admin | bulk record grades |
| POST | /api/admin/promote | admin | move to next semester |

## Roadmap

**Phase 3 — Next.js frontend** (scaffold already in `../frontend`)
- Wire the admin pages (students, curriculum, sections, results) to their endpoints above
- Wire the teacher pages (sections, roster) to `/api/sections/mine` and `/roster`
- Waitlist-position UI on the student dashboard
- Admin UI for `PUT /api/terms/:program/:term` (enrollment window + credit limit)

Say the word and I'll build those pages out.
