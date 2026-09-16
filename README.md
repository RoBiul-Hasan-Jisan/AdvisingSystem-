# CSE Advising System — Build Plan

Stack: **Next.js** (frontend, later phase) + **Node.js/Express** (backend) + **MongoDB** (data) + **Firebase Auth** (login).

## Roles & core workflows
- **Admin** — manage course catalog & prerequisites, create sections and set capacity, assign teachers, upload semester results, trigger promotion, override anything.
- **Teacher** — adjust capacity/schedule on their own sections.
- **Student** — see their default routine for their current semester, browse open sections, enroll (first-come-first-served, atomic seat claim), see a final dashboard. Taking a course outside their default plan (retake, elective, extra course) automatically flags them as having a **custom routine**.

## Data model (Phase 1 — done)
- `Course` — code, title, credits, category, prerequisites[]
- `Semester` — number (1–12) → default courseCodes offered
- `Section` — course + semester + term + capacity + seatsTaken + teacher + schedule
- `User` — role (admin/teacher/student), for students: currentSemester, completedCourses[], hasCustomRoutine
- `Enrollment` — student ↔ section, isExtraCourse flag, enrolledAt timestamp (the queue tiebreaker)

## The two trickiest pieces, already implemented
1. **Real first-come-first-served seats** (`routes/enrollment.js`): the seat claim uses
   `Section.findOneAndUpdate({ _id, $expr: { $lt: ['$seatsTaken','$capacity'] } }, { $inc: { seatsTaken: 1 } })`.
   This is atomic at the database level — if two students hit "enroll" on the last seat at the same
   millisecond, only one write succeeds and the other gets a 409 "section full." No race condition,
   no separate queue table needed for the common case.
2. **Auto-promotion** (`routes/promotion.js`): admin bulk-uploads a term's results; any student with
   zero fails in that term auto-advances `currentSemester + 1` and their custom-routine flag resets;
   anyone with a fail stays on the same semester (their retake next term is what makes their routine
   "custom" again, via the `isExtraCourse` check in the enroll route).

## What's included in this phase (files in `backend/`)
```
backend/
  models/       Course.js, Semester.js, Section.js, User.js, Enrollment.js
  routes/       courses.js, sections.js, enrollment.js, promotion.js
  middleware/   auth.js          (Firebase token verification + role guard)
  seed/         courses.json     (your full catalog, transcribed from the uploaded PDF)
                semesterPlan.json (courses per semester 1-12, from the advising structure PDF)
                seed.js          (loads both into MongoDB)
  server.js
  package.json
  .env.example
```

### ⚠️ Needs your confirmation
`semesterPlan.json` — semesters 2, 5 and 10 weren't cleanly delimited in the source PDF table
(columns bled together in extraction). Everything else transcribed cleanly. Fix those two arrays
once you can eyeball the original advising sheet, or send me a clearer screenshot of just those
rows and I'll redo them.

### How to run Phase 1
```bash
cd backend
cp .env.example .env      # fill in your MongoDB URI + Firebase service account path
npm install
npm run seed               # loads courses.json + semesterPlan.json into MongoDB
npm run dev
```
Then `GET /health` should return `{status:"ok"}`, and `GET /api/courses` (with a valid Firebase
token) returns your seeded catalog.

## Phase 2 — Auth & provisioning (done)
- `backend/routes/users.js` — admin provisions accounts (`POST /api/users` creates BOTH the
  Firebase login and the Mongo profile in one call, so nobody touches the Firebase console).
  Also `GET /api/users/me` (used by frontend right after login to route by role), list/filter,
  edit, delete.
- `backend/seed/bootstrapAdmin.js` — one-time script to create the *first* admin (chicken-and-egg
  fix: provisioning normally requires an admin token, but none exists on a fresh install).
  Run: `node seed/bootstrapAdmin.js "Your Name" you@example.com "TempPass123!"`

## Phase 4 — Frontend skeleton (done)
Next.js App Router app in `frontend/`. Visual identity is a "registrar's ledger" look (hairline
rules, brass accent, serif headings) rather than a generic rounded-card SaaS dashboard — see the
design plan comment at the top of `app/globals.css`.

```
frontend/
  lib/          firebase.js (client auth), api.js (fetch wrapper, attaches Firebase ID token)
  app/
    page.js                  login (routes to /admin, /teacher, or /student by role)
    components/Shell.js      shared sidebar layout
    student/routine/page.js  default routine, section picker, live seats, enroll button
    student/dashboard/page.js  confirmed schedule, drop button
    admin/courses/page.js    catalog CRUD (add course + prerequisites, deactivate)
    admin/sections/page.js   create sections, live capacity editing
    admin/users/page.js      provision accounts, record results, "run promotion" button
    teacher/page.js          teacher's own sections (?teacher=me), adjust capacity
```

### How to run Phase 2 + 4
```bash
# backend (Phase 1 must already be seeded)
cd backend
node seed/bootstrapAdmin.js "Admin Name" admin@yourschool.edu "TempPass123!"
npm run dev

# frontend
cd ../frontend
cp .env.local.example .env.local   # fill in your Firebase web app config
npm install
npm run dev
```
Log in as the bootstrapped admin at `http://localhost:3000`, provision teacher/student accounts
from **Accounts & promotion**, add sections from **Sections & capacity**, then log in as a student
to see the routine → enroll → dashboard flow end to end.

## Phase 3 — Schedule-conflict guard (done)
A student can no longer end up enrolled in two sections that overlap in time.

- `backend/utils/scheduleConflict.js` — converts the campus's time-string format ("8.30", "1.30",
  etc.) to minutes and checks for day+time overlap. Campus hours run 8:30am–6:00pm as one
  continuous block, so any hour below 8 is treated as PM (matches the real routine: 11.30-1.00 is
  followed by 1.30-3.00, not 1:30am).
- Wired into `routes/enrollment.js` as **step 3**, before the atomic seat claim — a conflicting
  request never touches seat counts, so it can't accidentally "use up" a seat and then fail.
  Returns `400` with which course it clashes with, e.g. `Time conflict: overlaps with CSE211 on
  Sunday 10.00-11.30`.
- `frontend/lib/scheduleConflict.js` mirrors the same logic client-side. On the routine page,
  a section that would clash with something the student's already enrolled in shows a red
  "Clashes with CSE211 (…)" note right under its schedule, and its Enroll button is disabled —
  so the student sees the problem before clicking, not after a rejected request.

### How to verify it
Enroll in a section, then try enrolling in a different section (any course) that shares a day and
an overlapping time slot in its `schedule[]`. The button should already be disabled with the clash
note visible; forcing the API call directly returns the 400 above.

## Phase 4b — Automatic PDF import per term (done)
Every ~4 months the registrar puts out a new advising-structure PDF (semesters, courses, sections,
seat counts) — this used to mean hand-editing `seed/courses.json` / `semesterPlan.json`. Now the
admin just uploads the PDF and the system reads it.

- `backend/utils/parseAdvisingPdf.js` — scans the PDF's extracted text for two patterns in document
  order: `Semester N` headings and `CODE NUM.SECTION (SEATS seats)` tokens (e.g. `CSE 211.3 (31
  seats)`). Each token is attributed to whichever heading last appeared before it — robust to PDF
  table columns getting flattened into a single text stream, which is the normal failure mode of
  PDF text extraction. Tolerates a common source typo (`(26) seats)` instead of `(26 seats)`).
- `backend/routes/structure.js` — `POST /api/structure/import` (admin, multipart PDF upload + a
  `term` name like "Fall 2026"). Upserts `Section` capacities and each semester's `courseCodes`
  plan. Safe to re-run: existing sections get capacity updated, new ones get created, and a section
  is **skipped with a warning** rather than silently corrupted if the new PDF would shrink its
  capacity below seats students have already taken. Also reports any course codes the PDF mentions
  that aren't in your catalog yet, so nothing silently fails to enroll.
- `backend/utils/currentTerm.js` + `models/Config.js` — a small singleton settings doc tracks which
  term is "active" right now, so `GET /api/enrollment/routine` and section browsing don't need a
  term param on every call. Defaults to whichever term was imported most recently if never set
  explicitly.
- `frontend/app/admin/structure/page.js` — upload form + import summary (created/updated counts,
  unknown-course list, skipped-capacity-shrink table, warnings).

### ⚠️ Data model change — re-seed if you already ran Phase 1's seed script
`Semester` used to be unique per `number` alone; it's now unique per `(number, term)`, since each
term gets its own course plan. If you already seeded a database under the old schema, drop the
`semesters` collection (or the whole database in dev) before re-running `npm run seed` — Mongo
won't auto-migrate the old unique index.

### How to run a term import
```bash
cd backend
npm install     # picks up the new multer + pdf-parse deps
npm run dev
```
Then, logged in as admin on the frontend: **Import structure** → name the term (e.g. "Fall 2026") →
choose the PDF → Import. Check the summary for unknown courses before students start enrolling.

## Phase 5 — Extra-course browsing (done)
The last functional gap: a student can now search the *entire* term's catalog — not just their
default semester's courses — and enroll in anything they're eligible for.

- `backend/routes/enrollment.js` — new `GET /api/enrollment/catalog`. Pulls every section open this
  term across all 12 semesters, groups by course, and computes eligibility per course: missing
  prerequisites, already passed, already enrolled this term, and whether it's part of the student's
  default plan or an "Extra" pick. Enrolling through the same `POST /enroll` as before still
  auto-flags it as an extra course and flips `hasCustomRoutine` — no new enrollment logic needed,
  this phase only needed a way to *see* everything else that's open.
- `frontend/app/student/catalog/page.js` — searchable table (by code or title), expandable per
  course to show its sections with live seats, schedule, and the same client-side conflict
  highlighting from Phase 3. Blocked/ineligible courses show why (missing prereqs, already passed,
  already enrolled) instead of just hiding a disabled button.
- Added to the student sidebar as **Browse courses**.

### How to verify it
Log in as a student, go to Browse courses, search for something outside your current semester's
list, expand it, and enroll — then check the Dashboard: it should show an "Extra" tag on that
enrollment, same as before.

## Phase 6 — Waitlist, audit log, CSV results, pagination (done)
This was the last batch of polish items. All four are in.

**Waitlist queue** (`backend/routes/enrollment.js`)
A full section no longer just rejects `POST /enroll` — the student is added to a real FIFO
waitlist instead (`Enrollment.status: 'waitlisted'`, ordered by `enrolledAt`, same as the section
queue itself). `POST /drop` on a confirmed seat now atomically promotes the longest-waiting student
on that section's waitlist into the freed seat, in the same request. `GET /dashboard` reports each
waitlisted enrollment's queue position. The routine/catalog/dashboard pages all show a "Waitlisted"
tag and let the button say "Join waitlist" instead of going dead when a section is full.

**Audit log** (`backend/models/AuditLog.js`, `backend/utils/auditLog.js`, `backend/routes/auditLog.js`)
Every admin mutation — course/section create/update/delete, provisioning, result entry (single,
bulk, and CSV), promotion runs, structure imports, current-term changes — writes a fire-and-forget
log entry (`{ admin, action, details, createdAt }`). A broken log write never fails the real
action. New admin screen: **Audit log**, paginated, most recent first.

**CSV bulk results** (`POST /api/promotion/bulk-csv`)
Admin uploads a CSV with header `studentId,courseCode,grade,status,term` — `studentId` here is the
human-readable ID field (e.g. "CSE-2201045"), the sheet registrar staff would actually build, not
Mongo's internal ID. Per-row errors (bad status, unknown student) are reported individually rather
than failing the whole upload. New form under **Accounts & promotion**.

**Pagination** (`GET /api/courses`, `GET /api/sections`)
Both now take `page`/`limit` (and `courses` also takes `search`), returning
`{ items, total, page, pages }` instead of a bare array. Admin's Course catalog and Sections &
capacity screens have Previous/Next controls; **Browse courses** paginates client-side (20/page)
since a single term's catalog is already fully loaded for eligibility computation anyway.

### ⚠️ Small breaking change
`GET /api/courses` and `GET /api/sections` changed response shape (paginated envelope instead of a
bare array). If you had anything else calling these directly outside the provided frontend, update
it to read `res.courses` / `res.sections`.

## Phase 7 — Rate limiting, notifications, tests, indexes (done)
The four "genuinely optional" items from before. All four are in.

**Rate limiting** (`backend/middleware/rateLimit.js`)
No external package (this sandbox can't reach the npm registry to add `express-rate-limit`), so
it's a small in-memory sliding-window limiter — same idea, same effect for a single-process
deployment. Applied in `server.js`: 120 req/min per IP across the whole `/api` surface, tightened
to 10/min on the two heaviest endpoints (`POST /api/structure/import` — PDF parsing, and
`POST /api/promotion/bulk-csv`), and 20/min on `/api/users` (account provisioning). Swap for a
Redis-backed limiter if you ever run more than one backend process behind a load balancer — noted
in the file.

**In-app notifications** (`backend/models/Notification.js`, `backend/routes/notifications.js`)
In-app only — there's no email/SMS provider configured (would need SendGrid/Twilio credentials
this environment doesn't have), but the hook point is ready: `Notification.create()` is called
in exactly one place right now, `routes/enrollment.js`'s waitlist-promotion logic, so a student
finds out when a seat opens up for them without needing to keep the dashboard open. Add a real
email send in that same spot once you have a provider. Shows in a small dropdown in the sidebar
(`components/Shell.js`), polling every 30s.

**Test suite** (`backend/tests/`)
Uses Node's built-in `node:test` + `assert` — no dependency to install, works with a bare
`npm test`. Covers the three pure, dependency-free modules: the PDF parser (line-wrap and
stray-paren typo tolerance, heading-attribution order, de-duplication), the schedule-conflict
checker (including the sub-8-hours-means-PM rule from Phase 3, and that back-to-back slots don't
false-positive), and the rate limiter itself (per-key isolation, custom key functions). **21
tests, all passing** — run with `npm test`. Route-level tests (hitting the actual Express app
against a real MongoDB) are the natural next step but need `mongodb-memory-server` or a test DB,
which needs network access this environment doesn't have; the pure-logic coverage here is what
was actually reachable.

**MongoDB indexes** — added after reviewing every query pattern actually used in the routes:
- `Enrollment`: `{student,term,status}` (routine/dashboard), `{student,courseCode,term,status}`
  (duplicate-course guard), `{section,status,enrolledAt}` (waitlist queue order + position)
- `Section`: `{term,semesterNumber}` (routine page), `{term,courseCode}` (catalog page),
  `{teacher}` (teacher's "my sections")
- `User`: `{role}` and `{role,currentSemester}` (admin account list filters)
- `Course`: `{active,code}` (every catalog list query filters on `active` first)

### How to run the tests
```bash
cd backend
npm test
```

## Phase 8 — Global error handling (done)
A real gap, not a nice-to-have: **Express 4 does not catch a rejected promise thrown inside an
`async` route handler.** Every route in Phases 1–7 was written `async (req, res) => { ... }` with
no error handling around most of them — if a Mongoose call threw (bad ObjectId in a URL, a
validation failure, a duplicate key), the request would just hang forever with no response, not
crash cleanly or return an error.

- `backend/middleware/asyncHandler.js` — wraps a handler so both an async rejection AND a
  synchronous throw reach Express's error pipeline via `next(err)` instead of hanging. (The
  synchronous-throw case was a genuine bug in the first version of this file — the test suite
  caught it before it shipped; see below.)
- `backend/middleware/errorHandler.js` — a 404 handler for unmatched routes, plus a central error
  handler (registered last in `server.js`) that maps `CastError` → 400 (bad ObjectId), Mongoose
  `ValidationError` → 400 with the actual field messages, duplicate-key `11000` → 409, Multer's
  file-size error → 400, and anything else → a generic 500 that never leaks internal error text
  to the client (logged server-side instead).
- **Every** route handler across `courses.js`, `sections.js`, `enrollment.js`, `promotion.js`,
  `users.js`, `structure.js`, `auditLog.js`, and `notifications.js` is now wrapped in
  `asyncHandler(...)`. A few routes kept their own local `try/catch` on top where it does
  something the generic handler can't — `users.js`'s account creation surfaces Firebase Admin SDK
  error messages (e.g. "email already in use") instead of a generic 500; `promotion.js`'s bulk/CSV
  loops catch per-row so one bad row doesn't abort the whole batch.
- New tests: `backend/tests/errorHandling.test.js` covers `asyncHandler` (including the
  synchronous-throw case that was initially broken) and every branch of the error handler.
  **30 tests total now, all passing.**

### How this was actually verified
`node --check` across every backend file (clean), then `npm test` — which is what caught the
`asyncHandler` bug on the first run (29/30 passing) before the fix (30/30). This is the difference
between "should work" and "ran and passed."

## Phase 9 — Hardening, deployment config, API docs (done)
The last batch of things a project needs before someone other than me could pick it up.

**Security & config**
- `backend/middleware/security.js` — basic security headers (`X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`). No `helmet` package (no npm registry access here), but
  these are the headers that actually matter for a JSON API.
- CORS is no longer wide open (`cors()` with no options = any origin can call this API). It now
  restricts to `FRONTEND_URL`, defaulting to `http://localhost:3000` for local dev.
- `server.js` now **fails fast at startup** with a clear message if `MONGO_URI` or
  `FIREBASE_SERVICE_ACCOUNT_PATH` are missing, instead of booting "successfully" and then every
  request mysteriously 500ing.
- `.gitignore` — didn't exist until now. Without it, `.env` and the Firebase service account JSON
  (real secrets) would get committed on a first `git add .`. Added at the repo root.

**Deployment config**
- `backend/Dockerfile` + root `docker-compose.yml` — one `docker compose up` runs MongoDB and the
  backend together for local dev. The Firebase service account file is mounted at runtime, never
  baked into the image.
- `.github/workflows/tests.yml` — GitHub Actions CI that runs both test suites (backend and
  frontend) on every push and PR. Validated the YAML parses correctly.

**Frontend tests** (`frontend/tests/scheduleConflict.test.mjs`)
The client-side schedule-conflict checker (`lib/scheduleConflict.js`) — used to disable the Enroll
button before a request even goes out — had been tag-balance-checked but never actually *run*
until now. `.mjs` because the source file uses `export function` (ES modules, matching Next.js's
own bundler); Node's test runner handles `.mjs` natively without needing `"type": "module"` in
`package.json`. **8 tests, all passing**, including the same sub-8-hours-means-PM edge case the
backend covers, plus a couple of defensive cases (empty schedule, unpopulated section) the backend
version didn't need to worry about.

**`API_REFERENCE.md`** — every endpoint, its required role, its body/query shape, and its rate
limit, in one place. Didn't exist before; the only way to know what an endpoint expected was to
read the route file.

### Final numbers
**Backend: 31 tests passing. Frontend: 8 tests passing.** Both verified by actually running
`npm test` in each folder, not just written and assumed to work.

## Remaining phases
Nothing functional, from "optional polish," from basic production-hardening, or from developer
experience (tests, CI, deployment config, API docs) is left outstanding. What's left now is
strictly what requires an environment this sandbox doesn't have:
- Route/integration tests against a real database (needs `mongodb-memory-server` or a live test
  DB — network access this sandbox doesn't have)
- Watching real query patterns once there's real data volume, in case the indexes need adjusting
- Actually running `docker compose up` or `npm install && npm run dev` for the first time outside
  this sandbox, against a real MongoDB Atlas cluster and a real Firebase project, and seeing what
  breaks on first contact

Tell me if something breaks when you actually run it, or if there's a new feature to add — at this
point that's genuinely the most useful next step, more than me continuing to add things
speculatively.
