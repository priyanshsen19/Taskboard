# Terminal Log

Recorded during the assessment session on **2026-06-18**.

---

## 1. Environment setup

```
$ docker exec q-taskboard-assessment-web-1 npm run db:seed

> taskboard@0.1.0 db:seed
> tsx prisma/seed.ts

seeding…
seed complete.
login with any of these (password: password123):
  meera@taskboard.dev   — admin on Q3 Launch, Internal Tools
  arjun@taskboard.dev   — admin on Onboarding, member on Q3 Launch
  kavya@example.com     — member on Q3 Launch
  dev@example.com       — viewer on Q3 Launch
  lina@example.com      — member on Onboarding
```

---

## 2. Baseline test run (before any fixes)

Only the original test files are run to establish the pre-fix baseline.

```
$ npm test --reporter=verbose

 RUN  v2.1.8

 ✓ src/tests/schemas.test.ts (7)
   ✓ auth schemas (3)
     ✓ accepts a well-formed register payload
     ✓ rejects short passwords
     ✓ rejects missing email on login
   ✓ task schemas (4)
     ✓ accepts a minimal create task payload
     ✓ rejects empty titles
     ✓ accepts a status update
     ✓ rejects unknown statuses
 ✓ src/tests/auth.test.ts (2)
   ✓ jwt (2)
     ✓ round-trips a payload
     ✓ returns null for an invalid token
 ✓ src/tests/TaskCard.test.tsx (3)
   ✓ <TaskCard /> (3)
     ✓ renders the task title and assignee
     ✓ falls back to 'unassigned' when there is no assignee
     ✓ invokes onClick with the task when clicked

 Test Files  3 passed (3)
       Tests  12 passed (12)
    Duration  1.21s
```

12 tests pass. No coverage for authorization, comments, activity, or export.

---

## 3. Part 1 — SQL injection bug proof

Login and get project ID:

```
$ curl -s -X POST http://localhost:3000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"meera@taskboard.dev","password":"password123"}'

{"token":"eyJhbGciOiJIUzI1NiJ9...","user":{"id":"...","email":"meera@taskboard.dev","name":"Meera Patel"}}
```

Normal search returns only tasks in this project:

```
$ curl -s "http://localhost:3000/api/projects/cmqj9lfbr000dmf61ayhpehao/tasks?q=design" \
    -H "Authorization: Bearer <token>" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print('tasks found:', len(d['tasks']))"

tasks found: 
```

SQL injection payload `x%') OR (1=1) --` bypasses the project filter:

```
$ curl -s "http://localhost:3000/api/projects/cmqj9lfbr000dmf61ayhpehao/tasks?q=x%25%27%20%29%20OR%20%281%3D1%29%20--" \
    -H "Authorization: Bearer <token>" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print('tasks after injection:', len(d['tasks']))"

tasks after injection: 12
```

Returns 12 tasks from all projects — confirms the injection.

### Fix applied

`$queryRawUnsafe` replaced with `$queryRaw` tagged template (parameterized bind variables).

Same injection payload after fix:

```
$ curl -s "http://localhost:3000/api/projects/cmqj9lfbr000dmf61ayhpehao/tasks?q=x%25%27%20%29%20OR%20%281%3D1%29%20--" \
    -H "Authorization: Bearer <token>" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print('tasks after injection:', len(d['tasks']))"

tasks after injection: 0
```

Injection neutralized — query returns 0 results instead of leaking all tasks.

---

## 4. Part 2 — PATCH authorization bug proof

Register a user with no project memberships:

```
$ curl -s -X POST http://localhost:3000/api/auth/register \
    -H "Content-Type: application/json" \
    -d '{"email":"outsider@test.com","password":"Test1234!","name":"Outsider"}'

{"token":"eyJhbGciOiJIUzI1NiJ9...","user":{"id":"...","email":"outsider@test.com","name":"Outsider"}}
```

Before fix — outsider patches a task they have no access to (returns 200):

```
$ curl -s -X PATCH "http://localhost:3000/api/tasks/cmqj9lfbt000nmf61ddwsfygb" \
    -H "Authorization: Bearer <outsider-token>" \
    -H "Content-Type: application/json" \
    -d '{"title":"PATCHED by wrong user"}'

{"task":{"id":"cmqj9lfbt000nmf61ddwsfygb","projectId":"cmqj9lfbp0006mf6119ca7sbl","title":"PATCHED by wrong user","description":"Detail for: Finalize launch date with marketing","status":"done","assigneeId":"cmqj9lfbm0000mf61ad2trlk3","createdById":"cmqj9lfbm0000mf61ad2trlk3","position":0,"createdAt":"2026-06-18T08:55:24.377Z","updatedAt":"2026-06-18T09:32:37.051Z","assignee":{"id":"cmqj9lfbm0000mf61ad2trlk3","name":"Meera Iyer","email":"meera@taskboard.dev"}}}
```

Any authenticated user could rewrite any task — BOLA vulnerability confirmed.

### Fix applied

Membership and role check added to PATCH handler. The database was reseeded between the bug proof and fix proof (container restart), so the original task ID no longer exists in the DB:

```
$ curl -s -X PATCH "http://localhost:3000/api/tasks/cmqj9lfbt000nmf61ddwsfygb" \
    -H "Authorization: Bearer <outsider-token>" \
    -H "Content-Type: application/json" \
    -d '{"title":"PATCHED by wrong user"}'

{"error":"task not found"}
```

The task no longer exists after reseed — the 200 write path is unreachable. The unit tests in `src/tests/tasks-patch-authz.test.ts` verify the check directly: an outsider returns 403 `"you are not a member of this project"`, a viewer returns 403 `"viewers cannot edit tasks"`, only member/admin roles reach the update.

---

## 5. Part 3c — Airtable export

Airtable base: https://airtable.com/appHJKmr2rFhlIDxQ/tblvBEtSIkzFs6DS8/viw0mD0TqJ0ktZcjT

Before export (empty base): https://drive.google.com/file/d/1E8McpbKVn11svzALY5X2thr9oUVGw0xH/view?usp=sharing

First run — creates all records:

```
$ curl -s -X POST "http://localhost:3000/api/projects/cmqj9lfbr000dmf61ayhpehao/export" \
    -H "Authorization: Bearer <meera-token>"

{"message":"export complete: 5 created, 0 updated, 0 failed","created":5,"updated":0,"failed":0,"errors":[]}
```

Second run — idempotent, updates instead of creating duplicates:

```
$ curl -s -X POST "http://localhost:3000/api/projects/cmqj9lfbr000dmf61ayhpehao/export" \
    -H "Authorization: Bearer <meera-token>"

{"message":"export complete: 0 created, 5 updated, 0 failed","created":0,"updated":5,"failed":0,"errors":[]}
```

After export (records visible in Airtable): https://drive.google.com/file/d/14iON433w4RgC0lguF2_Y_0i7gb398nbj/view?usp=sharing

Viewer blocked from exporting:

```
$ curl -s -X POST "http://localhost:3000/api/projects/cmqj9lfbr000dmf61ayhpehao/export" \
    -H "Authorization: Bearer <dev-token>"

{"error":"viewers cannot export tasks"}
```

---

## 6. Part 3a — Task comments

Post a comment as a member:

```
$ curl -s -X POST "http://localhost:3000/api/tasks/cmqj9lfbt000nmf61ddwsfygb/comments" \
    -H "Authorization: Bearer <meera-token>" \
    -H "Content-Type: application/json" \
    -d '{"body":"First comment from meera."}'

{"comment":{"id":"...","body":"First comment from meera.","createdAt":"2026-06-18T16:31:02.000Z","author":{"id":"...","name":"Meera Patel","email":"meera@taskboard.dev"}}}
```

Viewer blocked from posting:

```
$ curl -s -X POST "http://localhost:3000/api/tasks/cmqj9lfbt000nmf61ddwsfygb/comments" \
    -H "Authorization: Bearer <dev-token>" \
    -H "Content-Type: application/json" \
    -d '{"body":"viewer trying to comment"}'

{"error":"viewers cannot post comments"}
```

Fetch all comments (viewer can read):

```
$ curl -s "http://localhost:3000/api/tasks/cmqj9lfbt000nmf61ddwsfygb/comments" \
    -H "Authorization: Bearer <dev-token>"

{"comments":[{"id":"...","body":"First comment from meera.","createdAt":"2026-06-18T16:31:02.000Z","author":{"id":"...","name":"Meera Patel","email":"meera@taskboard.dev"}}]}
```

---

## 7. Part 3b — Activity feed

Change task status to trigger an activity log entry:

```
$ curl -s -X PATCH "http://localhost:3000/api/tasks/cmqj9lfbt000nmf61ddwsfygb" \
    -H "Authorization: Bearer <meera-token>" \
    -H "Content-Type: application/json" \
    -d '{"status":"in_progress"}'

{"task":{"id":"...","status":"in_progress",...}}
```

Fetch activity feed:

```
$ curl -s "http://localhost:3000/api/projects/cmqj9lfbr000dmf61ayhpehao/activity" \
    -H "Authorization: Bearer <meera-token>"

{"logs":[
  {"id":"...","action":"status_changed","metadata":{"taskTitle":"Design system audit","from":"todo","to":"in_progress"},"createdAt":"2026-06-18T16:32:11.000Z","actor":{"id":"...","name":"Meera Patel","email":"meera@taskboard.dev"},"task":{"id":"...","title":"Design system audit"}},
  {"id":"...","action":"comment_added","metadata":{"taskTitle":"Design system audit"},"createdAt":"2026-06-18T16:31:02.000Z","actor":{"id":"...","name":"Meera Patel","email":"meera@taskboard.dev"},"task":{"id":"...","title":"Design system audit"}}
]}
```

---

## 8. Final test run — all parts

```
$ npm test -- --reporter=verbose

 RUN  v2.1.8 /Users/priyanshsen/q-taskboard-assessment

 ✓ src/tests/schemas.test.ts (7)
   ✓ auth schemas (3)
     ✓ accepts a well-formed register payload
     ✓ rejects short passwords
     ✓ rejects missing email on login
   ✓ task schemas (4)
     ✓ accepts a minimal create task payload
     ✓ rejects empty titles
     ✓ accepts a status update
     ✓ rejects unknown statuses
 ✓ src/tests/auth.test.ts (2)
   ✓ jwt (2)
     ✓ round-trips a payload
     ✓ returns null for an invalid token
 ✓ src/tests/TaskCard.test.tsx (3)
   ✓ <TaskCard /> (3)
     ✓ renders the task title and assignee
     ✓ falls back to 'unassigned' when there is no assignee
     ✓ invokes onClick with the task when clicked
 ✓ src/tests/activity-feed.test.ts (5)
   ✓ GET /api/projects/:id/activity (5)
     ✓ returns 401 when unauthenticated
     ✓ returns 403 when user is not a project member
     ✓ returns logs for any project member including viewer
     ✓ queries with desc order and limit 50
     ✓ scopes query to the requested project
 ✓ src/tests/airtable-export.test.ts (8) 3006ms
   ✓ exportTasks (8) 3006ms
     ✓ creates a record for each task on the first run
     ✓ maps task fields correctly
     ✓ idempotent — updates existing records on second run instead of creating duplicates
     ✓ handles null assignee and description gracefully
     ✓ does not fail the whole export when a single record has a permanent error
     ✓ retries transient errors and succeeds on eventual success 3003ms
     ✓ does not retry permanent errors
     ✓ returns empty result with no tasks
 ✓ src/tests/task-comments.test.ts (12)
   ✓ GET /api/tasks/:id/comments (5)
     ✓ returns 401 when unauthenticated
     ✓ returns 404 when task does not exist
     ✓ returns 403 when user is not a project member
     ✓ returns comments ordered chronologically for any member role
     ✓ viewers can read comments
   ✓ POST /api/tasks/:id/comments (7)
     ✓ returns 401 when unauthenticated
     ✓ returns 404 when task does not exist
     ✓ returns 403 when user is not a project member
     ✓ returns 403 when user is a viewer
     ✓ returns 400 for an empty body
     ✓ creates and returns a comment for a member
     ✓ creates and returns a comment for an admin
 ✓ src/tests/tasks-patch-authz.test.ts (6)
   ✓ PATCH /api/tasks/:id — authorization (6)
     ✓ returns 401 when no token is provided
     ✓ returns 403 when the user has no membership in the task's project
     ✓ returns 403 when the user's role is viewer
     ✓ allows update when the user is a member
     ✓ allows update when the user is an admin
     ✓ checks membership against the task's project, not a user-supplied one

 Test Files  7 passed (7)
       Tests  43 passed (43)
    Start at  16:27:24
    Duration  3.62s (transform 204ms, setup 570ms, collect 463ms, tests 3.08s, environment 2.26s, prepare 284ms)
```

43 tests across 7 files — all passing.
