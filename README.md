# Advising System — Monorepo

```
advising-system/
├── backend/     Node + Express + MongoDB API, Firebase-token auth
└── frontend/    Next.js (App Router) + Tailwind, Firebase client auth
```

## Backend (`/backend`)
```
backend/
├── server.js            entry point only — connect DB, then listen
├── src/
│   ├── app.js            Express app + route mounting (no listen — testable)
│   ├── config/           db.js, firebase.js
│   ├── middleware/        auth.js (verifies Firebase token → loads Mongo user), rateLimit.js
│   ├── models/            Course, CurriculumSlot, Section, User, Enrollment, Routine,
│   │                      CourseRequest, Notification, Term, AuditLog, Config
│   ├── routes/            me, courses, sections, enrollment, routines, admin, terms,
│   │                      import, notifications, auditLog
│   ├── seed/              real catalog/curriculum/sample-section data + loader
│   └── utils/             asyncHandler.js, auditLog.js, currentTerm.js, scheduleConflict.js,
│                          parsePassed.js
tests/                     18 passing `node --test` cases — run with `npm test`
```
Run: `cd backend && npm install && cp .env.example .env && npm run seed && npm test && npm run dev`

## Frontend (`/frontend`)
```
frontend/
├── app/
│   ├── (auth)/login/                 sign-in
│   ├── (student)/dashboard/          landing page after login
│   ├── (student)/routine/            regular/custom routine + section picker
│   ├── (admin)/admin/students/       student list, add/promote
│   ├── (admin)/admin/curriculum/     11-semester plan editor
│   ├── (admin)/admin/sections/       capacity/schedule editor
│   ├── (admin)/admin/results/        bulk grade upload → promotion
│   ├── (teacher)/teacher/sections/   a teacher's own sections
│   └── (teacher)/teacher/roster/     roster per section
├── components/
│   ├── sections/SectionPicker.tsx    the enroll/waitlist button, live seats-left
│   ├── routine/  ui/  admin/          (grow these out per page in Phase 3)
├── hooks/useAuth.ts                  Firebase auth state + backend profile
├── lib/firebase.ts                   Firebase client init
├── lib/api.ts                        typed fetch wrapper (attaches ID token)
└── types/index.ts                    types mirroring the backend Mongo models
```
The route groups `(auth)`, `(student)`, `(admin)`, `(teacher)` don't affect the URL —
they're just how the codebase separates "who this page is for". Each group has a
`layout.tsx` that checks the signed-in user's role (via `useAuth`) and redirects to
`/login` if it doesn't match — so a student can't reach `/admin/students` by
URL-guessing, and those routes are marked `force-dynamic` since an auth-gated page
should never be served as static HTML.

Run: `cd frontend && npm install && cp .env.local.example .env.local && npm run dev`

**Pages wired to real endpoints (Phase 3, done):**
- `/admin/students` — filter by program/semester, add a student, select + promote, remove
- `/admin/curriculum` — per-program/semester course checklist against the real catalog
- `/admin/sections` — open a section, adjust capacity, open/close, filter by course
- `/admin/results` — bulk grade entry, then points to Students for the deliberate promote step
- `/admin/terms` — enrollment window + credit limit per program
- `/admin/import` — upload a new term's Advising Structure PDF, review the parsed
  curriculum/sections/seat-counts, confirm to bulk-import (the "plan changes every
  4 months" workflow)
- `/admin/requests` — review students' extra/retake course requests, approve/reject
- `/admin/audit-log` — every admin action, newest first, filterable by action type
- `/admin/terms` — enrollment window + credit limit per program, plus the "current term"
  control (`useCurrentTerm` hook) that every other page reads instead of hardcoding a term
- `middleware.ts` + `/api/session` — server-side check (Firebase session cookie,
  verified via `jose`) that redirects unauthenticated requests to `/login` before
  a protected page renders, alongside the client-side role guards per layout
- `/teacher/sections` → `/teacher/roster` — a teacher's sections, click through to roster, drop a student
- `/dashboard`, `/routine` — student's own enrollment + live waitlist position, section picker
  with a client-side schedule-clash pre-check before it ever calls enroll

Verified with a full `next build` (all 18 routes compile and prerender cleanly, confirmed
the middleware genuinely 307-redirects an unauthenticated request via `curl` against a real
built server) and `tsc --noEmit` (zero type errors) once real Firebase env values are present.


## Why split this way
- **`src/` in the backend** keeps `server.js` a one-job file (start the process) so it's
  trivial to reuse `src/app.js` in tests (`supertest(app)`) without spinning up Mongo or a port.
- **Route groups in the frontend** mean a student can never accidentally land on
  `/admin/students` by URL-guessing without also passing through that group's guard —
  and `/admin/*`, `/teacher/*`, `/dashboard`, `/routine` stay as the actual visible URLs.
- **`lib/api.ts` as the only place that calls `fetch`** means swapping auth schemes,
  adding retry logic, or pointing at a staging API later touches one file, not every page.
