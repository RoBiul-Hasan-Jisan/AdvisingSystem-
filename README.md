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

## Remaining phases
- **Phase 2 — Auth & provisioning**: Firebase project setup, `POST /api/users` for admin to
  provision accounts (role + studentId), login flow.
- **Phase 3 — Routine generation UI logic**: default routine builder already exists as an API
  (`GET /api/enrollment/routine`); needs the section-schedule-conflict check (don't let a student
  pick two overlapping time slots) added server-side before the frontend is built.
- **Phase 4 — Frontend (Next.js)**: Admin panel (catalog CRUD, section/capacity manager, result
  upload + promote button), Teacher panel (their sections, live seat counts), Student flow
  (routine view → section picker with live seats-left → dashboard).
- **Phase 5 — Polish**: waitlist-on-full (optional queue beyond just rejecting), notifications,
  audit log of admin actions, CSV import for results instead of JSON body.

