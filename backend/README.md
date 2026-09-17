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
- **Audit log** of every admin write (course/curriculum/section/student/result/promotion/
  term/import/request-review changes), each entry with the admin's name and a JSON detail blob
- **Rate limiting** (in-memory sliding window) on the whole API, tighter on `/api/enrollment`
- **Config-driven "current term"** — `GET/PUT /api/terms/current` - no page hardcodes a term string
- **Real test suite** — 18 passing `node --test` cases covering the shared schedule-conflict
  logic, the rate limiter, `asyncHandler`, and CSV-passed-column parsing (`npm test`)
- 108-course catalog (full University Program elective list included)

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
CourseRequest     student, term, courseCode, reason, status(PENDING|APPROVED|REJECTED)
Notification      user, type, message, read
AuditLog          admin, adminName, action, details, createdAt
Config            key, value   (currently just "currentTerm")
```

## Running it
```bash
cd backend
npm install
cp .env.example .env        # fill in MONGODB_URI and Firebase service account
npm run seed                # loads real course catalog + curriculum + sample sections
npm test                    # 18 unit tests (schedule conflict, rate limit, asyncHandler, CSV parsing)
npm run dev
```

Per student/teacher/admin: create their Firebase Auth account (frontend sign-up or Firebase
console), then `POST /api/admin/students` to link that `firebaseUid` to a Mongo user with the
right role. To let a teacher see their own sections via `GET /api/sections/mine`, set their
`teacherShortCode` (via `PATCH /api/admin/students/:id`) to match the faculty code used in
`Section.faculty` (e.g. "SAH", "JUD" — see the routine doc's faculty list).

## Importing a new term (every ~4 months, the recurring workflow)

The university reissues its Advising Structure PDF each term with that term's
curriculum, section counts, and seat capacities. Instead of hand-editing all of
that, admin uploads the new PDF from the frontend's `/admin/import` page (or
directly against the API below) and reviews the parsed result before anything
is written to the database:

```
POST /api/admin/import/preview   multipart field "pdf"  -> parsed JSON, nothing saved yet
POST /api/admin/import/confirm   the (optionally edited) preview body -> bulk-upserts
```

`scripts/parse_advising_pdf.py` does the actual parsing (pdfplumber under the
hood, invoked by the `/preview` route via a subprocess) - it reads the PDF's
own title metadata ("CSE Advising Structure - Summer 2026") for program/term,
matches each "Semester N" table by position, and extracts every
`CODE.section (NN seats)` entry. Tested against the real Summer 2026 PDF:
**367 sections across 11 semesters, zero warnings** - see
`scripts/parsed-advising.sample.json` for the actual output. A lab section
split into sub-groups with different capacities (a real quirk in the source
data - see `CSE 216.4` in the sample) gets its seats summed and flagged with
a `note`, surfaced as an orange "*split-group" marker in the preview UI.

`/confirm` replaces each affected semester's curriculum wholesale and
upserts sections by `(courseCode, sectionNumber, term)` - capacity updates in
place, but an existing section's `schedule`/`faculty` (set by hand or via the
routine-doc import below) is preserved, not wiped, since the Advising
Structure PDF never carries room/time data.

```bash
pip install -r scripts/requirements.txt --break-system-packages
```

## Importing the real routine (optional, room/time/faculty - separate from the above)
```bash
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
| POST | /api/admin/import/preview | admin | upload+parse an Advising Structure PDF (nothing saved) |
| POST | /api/admin/import/confirm | admin | bulk-upsert the (reviewed) parsed curriculum+sections |
| POST | /api/enrollment/enroll | student | pick a section (window+credit+clash checked, FCFS) |
| POST | /api/enrollment/drop | student/staff | drop, auto-promotes waitlist |
| GET | /api/enrollment/me?term= | student | their enrollment + live waitlist position |
| POST | /api/enrollment/admin-assign | admin/teacher | force-place a student |
| GET | /api/admin/students | admin | list/filter students |
| POST/PATCH/DELETE | /api/admin/students... | admin | manage students |
| POST | /api/admin/results | admin | bulk record grades (one row at a time) |
| POST | /api/admin/results/csv | admin | bulk record grades from a CSV upload |
| POST | /api/admin/promote | admin | move to next semester |
| POST | /api/routines/request | student | ask for an extra/retake course this term |
| GET | /api/routines/requests?status=&term= | admin | list course requests |
| POST | /api/routines/requests/:id/approve | admin | approve -> folds into student's routine + notifies them |
| POST | /api/routines/requests/:id/reject | admin | reject with an optional note -> notifies them |
| GET | /api/notifications/me | any | this user's notifications, unread first |
| POST | /api/notifications/:id/read | any | mark one read |
| POST | /api/notifications/read-all | any | mark all read |
| GET | /api/audit-log?action=&limit= | admin | every admin action, newest first |
| GET | /api/terms/current | any | which term the whole app should default to |
| PUT | /api/terms/current | admin | flip which term is active |

## Roadmap

**Phase 3 — done.** All admin/teacher/student pages in `../frontend` are wired to
these endpoints (students, curriculum, sections, results, terms, roster, routine +
enrollment). Verified with a full `next build` and `tsc --noEmit`.

**Phase 3.5 — done.** PDF-driven term rollover: `/admin/import` uploads the new
term's Advising Structure PDF, parses it (367 real sections verified against the
actual Summer 2026 PDF), and bulk-imports curriculum + section capacity after
admin review.

**Phase 4 — done.**
- CSV upload for results (`POST /api/admin/results/csv`) alongside the row-by-row form
- Student-facing "request an extra/retake course" flow (`/api/routines/request` +
  `/api/routines/requests` for admin to approve/reject) - approval folds the course
  into the student's routine automatically and notifies them
- In-app notifications (`Notification` model + `/api/notifications/*`) - fired on
  waitlist promotion and on request approve/reject. No SMTP provider is configured
  in this project, so this is in-app rather than email; swapping in real email later
  means adding a send step alongside the existing `Notification.create()` calls, not
  restructuring anything
- Server-side auth check: `frontend/middleware.ts` verifies the Firebase session
  cookie (via `jose` against Firebase's public JWKS) before a protected page's shell
  even renders, redirecting straight to `/login` if it's missing/invalid/expired -
  confirmed live with `curl` against a built server (307 redirect, no page code
  executed). This is defense-in-depth alongside, not instead of, the client-side
  role guards and the backend's own `requireRole` on every request - the backend
  remains the real authorization boundary since the frontend can be bypassed by
  calling the API directly.

**Still open**
- Run the routine-doc parser (room/time/faculty) as part of the same `/admin/import`
  flow, merged by (courseCode, sectionNumber), instead of a separate manual script
- Real email delivery (would need an SMTP/provider credential this project doesn't have)
- Auto-promotion by rule (currently 100% manual selection, by design — see below)

## Merged from a second implementation

A second build of this same project existed with real strengths this one didn't have -
rather than picking one over the other, the good parts of both are combined here.
Cherry-picked in (and adapted to fit this codebase's structure):

- **Audit log** — every admin action recorded with a denormalized admin name
- **Rate limiting** — in-memory sliding-window limiter, no extra dependency
- **Config-driven "current term"** — fixes a real design smell this project had (multiple
  frontend pages hardcoded `const TERM = 'Summer 2026'`, meaning a term rollover required a
  code change; now it's an admin action, `PUT /api/terms/current`)
- **Capacity-shrink protection** on PDF re-import — a section's capacity can't be silently
  set below the number of students already enrolled in it
- **Unknown-course-code detection** on PDF import — flags codes the PDF references that
  aren't in the catalog yet, so enrollment doesn't silently 404 for them later
- **A real test suite** — this project had zero automated tests before; now 18
- **Seat-rollback on enrollment-create failure** — if the atomic seat grab succeeds but the
  Enrollment write then fails (a rare race), the seat claim is rolled back rather than left
  as a phantom taken seat
- **Extra University Program electives** — their static seed had 108 courses to this
  project's 89; the missing 19 were cross-checked against the original catalog PDF and added
- **Shared, single-implementation schedule-conflict logic** — this project previously had
  the day/time-overlap check duplicated (with slightly different code) in both
  `enrollment.js` and `routines.js`; now both call one tested `src/utils/scheduleConflict.js`
- Wired the previously-built-but-never-called `check-clash` endpoint into the actual
  `SectionPicker` frontend component, so a student sees a clash warning before clicking
  enroll, not just as a rejected request after

**Deliberately NOT merged in**, with reasons:
- Their PDF parser (`pdf-parse` + line-based regex) — verified against the real Summer 2026
  PDF, it found only 6 of 11 semesters correctly and produced 65 duplicate-key collisions
  from unhandled split-lab sections, vs. this project's `pdfplumber`-based parser (table/
  position-aware) verified at 367 sections across all 11 semesters, zero warnings. This
  project's approach costs a Python subprocess dependency; theirs would need a real
  structural fix (position-aware matching, not linear-text regex) before it's trustworthy
  on this data
- Their fully-automatic promotion (auto-advance on zero fails, auto-hold on any fail) —
  this project keeps promotion a deliberate admin selection instead. Automatic promotion is
  a reasonable choice too (it's genuinely more "done" as a feature), but it removes the
  human review step for edge cases (incomplete grades, withdrawals, appeals) that a
  registrar would normally want to catch before it happens, not after
- Their unrestricted self-enroll-in-any-catalog-course model (auto-flagged as "extra") —
  this project keeps the admin-approval gate (`CourseRequest`) for extra/retake courses,
  closer to "admin can do anything" from the original spec
- Their `Enrollment` model lacking a DB-level unique constraint on (student, courseCode,
  term) — this project's partial unique index stays, since without it a race condition can
  double-enroll a student in two sections of the same course
