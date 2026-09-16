# API Reference

Base URL: `http://localhost:5000` (or your deployed backend URL).
Every route except `/health` requires `Authorization: Bearer <firebase-id-token>`.
Roles in **bold** in the "Auth" column are the only roles allowed to call that route.

All error responses share the shape `{ "error": "..." }`. Validation errors (400), not-found (404),
conflicts like duplicate keys or full sections (409), and unexpected server errors (500) are all
produced by the central error handler in `middleware/errorHandler.js` — see Phase 8 in `README.md`.

---

## Structure import

| Method | Path | Auth | Body | Notes |
|---|---|---|---|---|
| POST | `/api/structure/import` | **admin** | multipart: `file` (PDF), `term`, `setAsCurrentTerm` | Parses the advising PDF, upserts sections + semester plans. Rate-limited to 10/min. |
| GET | `/api/structure/current-term` | any | — | `{ currentTerm }` |
| PUT | `/api/structure/current-term` | **admin** | `{ term }` | Manually override the active term |

## Audit log

| Method | Path | Auth | Query | Notes |
|---|---|---|---|---|
| GET | `/api/audit-log` | **admin** | `page`, `limit` | Paginated, newest first |

## Accounts

| Method | Path | Auth | Body | Notes |
|---|---|---|---|---|
| GET | `/api/users/me` | any | — | The logged-in user's own profile |
| GET | `/api/users` | **admin** | query: `role`, `semester` | List/filter accounts |
| POST | `/api/users` | **admin** | `{ name, email, password, role, studentId?, currentSemester? }` | Creates BOTH the Firebase login and Mongo profile. Rate-limited to 20/min. |
| PUT | `/api/users/:id` | **admin** | `{ name?, role?, studentId?, currentSemester? }` | |
| DELETE | `/api/users/:id` | **admin** | — | Removes both the Firebase login and Mongo profile |

## Course catalog

| Method | Path | Auth | Query/Body | Notes |
|---|---|---|---|---|
| GET | `/api/courses` | any | `page`, `limit`, `search` | Returns `{ courses, total, page, pages }` |
| GET | `/api/courses/:code` | any | — | One course |
| POST | `/api/courses` | **admin** | `{ code, title, credits, category, prerequisites[] }` | |
| PUT | `/api/courses/:code` | **admin** | any subset of the above | |
| DELETE | `/api/courses/:code` | **admin** | — | Soft delete (`active: false`) — keeps history for students who took it |

## Sections

| Method | Path | Auth | Query/Body | Notes |
|---|---|---|---|---|
| GET | `/api/sections` | any | `semesterNumber`, `term`, `courseCode`, `teacher=me`, `page`, `limit` | Returns `{ sections, total, page, pages }` |
| POST | `/api/sections` | **admin** | `{ courseCode, sectionLabel, semesterNumber, term, capacity, teacher?, schedule? }` | |
| PUT | `/api/sections/:id` | **admin** or the assigned **teacher** | `{ capacity?, schedule?, teacher? }` | Can't drop capacity below seats already taken |
| DELETE | `/api/sections/:id` | **admin** | — | Blocked if the section has active enrollments |

## Enrollment (the core student flow)

| Method | Path | Auth | Body | Notes |
|---|---|---|---|---|
| GET | `/api/enrollment/routine` | **student** | — | Default semester's courses + open sections + the student's own picks |
| GET | `/api/enrollment/catalog` | **student** | — | EVERY section open this term, with eligibility computed per course |
| POST | `/api/enrollment/enroll` | **student** | `{ sectionId }` | Checks prerequisites → duplicate course → schedule conflict → atomic seat claim → waitlist if full. Returns `201` (enrolled) or `202` (waitlisted). |
| POST | `/api/enrollment/drop` | **student** | `{ enrollmentId }` | Frees the seat; auto-promotes the next waitlisted student if any |
| GET | `/api/enrollment/dashboard` | **student** | — | Confirmed + waitlisted courses, with queue position |

## Results & promotion

| Method | Path | Auth | Body | Notes |
|---|---|---|---|---|
| POST | `/api/promotion/result` | **admin** | `{ studentId, courseCode, grade, status, term }` | `studentId` = Mongo `_id` here |
| POST | `/api/promotion/bulk` | **admin** | `{ results: [{ studentId, courseCode, grade, status, term }] }` | Same as above, batched |
| POST | `/api/promotion/bulk-csv` | **admin** | multipart: `file` (CSV) | Header row: `studentId,courseCode,grade,status,term` — `studentId` here is the human-readable `User.studentId` field, not the Mongo `_id`. Rate-limited to 10/min. |
| POST | `/api/promotion/promote` | **admin** | `{ term }` | Advances everyone with zero fails that term by one semester |

## Notifications

| Method | Path | Auth | Body | Notes |
|---|---|---|---|---|
| GET | `/api/notifications` | any | — | `{ notifications, unreadCount }` |
| POST | `/api/notifications/:id/read` | any | — | Marks one read |
| POST | `/api/notifications/read-all` | any | — | Marks everything read |

## Health check

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health` | none | `{ status: "ok" }` — no rate limit, no auth, for uptime monitors |

---

## Rate limits (see `server.js`)
- All of `/api/*`: 120 requests/minute per IP
- `/api/structure/import`, `/api/promotion/bulk-csv`: 10/minute per IP
- `/api/users`: 20/minute per IP

Exceeding a limit returns `429` with a `Retry-After` header (seconds).
