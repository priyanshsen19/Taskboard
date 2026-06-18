# Code Review — Security & Quality Findings

**Reviewer:** Claude Code  
**Date:** 2026-06-18  
**Branch:** main

---

## Issue 1 — SQL Injection in Task Search

| Field | Value |
|---|---|
| **File** | [`src/app/api/projects/[id]/tasks/route.ts:27–34`](src/app/api/projects/%5Bid%5D/tasks/route.ts) |
| **Category** | Security |
| **Severity** | Critical |

### Description

The `GET /api/projects/:id/tasks?q=` handler builds a raw SQL query by directly interpolating `projectId` and the `q` search parameter into a template string, then executes it with `$queryRawUnsafe`. An attacker can break out of the `AND (...)` group and inject arbitrary SQL, bypassing the `project_id =` filter entirely and returning tasks from every project in the database.

### Proof

**Request** — payload `x%') OR (1=1) --` produces the SQL:
`WHERE project_id = '...' AND (title ILIKE '%x%' ) OR (1=1) --`

```bash
# Normal response: 5 tasks (this project only)
curl -s "http://localhost:3000/api/projects/cmqj9lfbr000dmf61ayhpehao/tasks" \
  -H "Authorization: Bearer <token>" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('tasks:', len(d['tasks']))"
# tasks: 5

# Injected response: 12 tasks (all projects)
curl -s "http://localhost:3000/api/projects/cmqj9lfbr000dmf61ayhpehao/tasks?q=x%25%27%20%29%20OR%20%281%3D1%29%20--" \
  -H "Authorization: Bearer <token>" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('tasks:', len(d['tasks']))"
# tasks: 12
```

### Recommended Fix

Replace `$queryRawUnsafe` with Prisma's `$queryRaw` tagged template, which passes all values as parameterized bind variables:

```ts
const pattern = `%${q}%`;
const tasks = await prisma.$queryRaw`
  SELECT id, project_id, title, description, status,
         assignee_id, created_by_id, position, created_at, updated_at
  FROM tasks
  WHERE project_id = ${projectId}
    AND (title ILIKE ${pattern} OR description ILIKE ${pattern})
  ORDER BY position ASC
`;
```

---

## Issue 2 — Broken Object-Level Authorization on Task Update

| Field | Value |
|---|---|
| **File** | [`src/app/api/tasks/[id]/route.ts:16–37`](src/app/api/tasks/%5Bid%5D/route.ts) |
| **Category** | Security |
| **Severity** | Critical |

### Description

The `PATCH /api/tasks/:id` handler authenticates the user but never checks whether that user is a member of the project that owns the task, nor whether their role permits editing. Any authenticated user who knows (or can guess) a task ID can update its title, description, status, assignee, or position. The sibling `DELETE` handler in the same file correctly enforces membership and role; the authorization check was simply omitted from `PATCH`.

### Recommended Fix

After fetching `existing`, add the same membership and role guard used in `DELETE`:

```ts
const existing = await prisma.task.findUnique({ where: { id } });
if (!existing) return notFound("task not found");

// Add these two lines:
const membership = await getProjectMembership(user.id, existing.projectId);
if (!membership) return forbidden("you are not a member of this project");
if (!canEditTasks(membership.role)) return forbidden("viewers cannot edit tasks");

const task = await prisma.task.update({ ... });
```

---

## Issue 3 — `passwordHash` Leaked in Project Detail Response

| Field | Value |
|---|---|
| **File** | [`src/app/api/projects/[id]/route.ts:28–35`](src/app/api/projects/%5Bid%5D/route.ts) |
| **Category** | Security |
| **Severity** | High |

### Description

`GET /api/projects/:id` uses bare `include: { user: true }` / `owner: true` on four separate relations (project owner, memberships, task assignees, task creators). Because no `select` clause is specified, Prisma returns every column of the `users` table — including `passwordHash`. Any project member can retrieve the bcrypt hashes of every other member, the project owner, and any task author, and use them for offline cracking.

**Confirmed via curl:**

```json
"owner": {
  "id": "cmqj9lfbn0001mf61n5ro24y3",
  "email": "meera@taskboard.dev",
  "name": "Meera Patel",
  "passwordHash": "$2a$10$GIXIYATC04JyfUU/Xqihe.JfIECJ3kPClHg2Z.l1OXLi/ZRbbtoAa",
  ...
}
```

### Recommended Fix

Scope every user relation to safe fields only:

```ts
const SAFE_USER = { select: { id: true, name: true, email: true } } as const;

prisma.project.findUnique({
  where: { id },
  include: {
    owner: SAFE_USER,
    memberships: { include: { user: SAFE_USER } },
    tasks: {
      include: {
        assignee: SAFE_USER,
        createdBy: SAFE_USER,
      },
    },
  },
});
```

---

## Issue 4 — N+1 Full Table Scan for Task Count in Project List

| Field | Value |
|---|---|
| **File** | [`src/app/api/projects/route.ts:10–21`](src/app/api/projects/route.ts) |
| **Category** | Performance |
| **Severity** | Medium |

### Description

`GET /api/projects` fetches all memberships with `tasks: true` (every task row across every project the user belongs to) solely to compute `m.project.tasks.length` on line 29. For a user with 10 projects of 500 tasks each, this allocates 5,000 full task objects in memory and discards them immediately. The query time and memory use scale linearly with total task count rather than project count.

### Recommended Fix

Use Prisma's `_count` aggregation so the database returns a single integer per project instead of all task rows:

```ts
const memberships = await prisma.membership.findMany({
  where: { userId: user.id },
  include: {
    project: {
      include: {
        owner: { select: { id: true, name: true, email: true } },
        _count: { select: { tasks: true } },
      },
    },
  },
  orderBy: { createdAt: "desc" },
});

const projects = memberships.map((m) => ({
  ...
  taskCount: m.project._count.tasks,  // integer, no rows transferred
}));
```
