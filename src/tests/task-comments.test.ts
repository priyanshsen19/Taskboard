import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/tasks/[id]/comments/route";
import { prisma } from "@/lib/prisma";
import * as authLib from "@/lib/auth";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: { findUnique: vi.fn() },
    comment: { findMany: vi.fn(), create: vi.fn() },
    activityLog: { create: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getCurrentUser: vi.fn(), getProjectMembership: vi.fn() };
});

const MOCK_USER = { id: "user-1", email: "a@b.com", name: "Alice" };
const MOCK_TASK = { projectId: "project-1" };
const MOCK_COMMENT = {
  id: "comment-1",
  taskId: "task-1",
  authorId: "user-1",
  body: "Looks good to me",
  createdAt: new Date("2026-01-01T10:00:00Z"),
  author: { id: "user-1", name: "Alice", email: "a@b.com" },
};

function makeParams(id = "task-1") {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(method: string, body?: object) {
  return new NextRequest(`http://localhost/api/tasks/task-1/comments`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe("GET /api/tasks/:id/comments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.task.findUnique).mockResolvedValue(MOCK_TASK as never);
    vi.mocked(prisma.comment.findMany).mockResolvedValue([MOCK_COMMENT] as never);
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(authLib.getCurrentUser).mockResolvedValue(null);
    const res = await GET(makeRequest("GET"), makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 404 when task does not exist", async () => {
    vi.mocked(authLib.getCurrentUser).mockResolvedValue(MOCK_USER);
    vi.mocked(prisma.task.findUnique).mockResolvedValue(null);
    const res = await GET(makeRequest("GET"), makeParams());
    expect(res.status).toBe(404);
  });

  it("returns 403 when user is not a project member", async () => {
    vi.mocked(authLib.getCurrentUser).mockResolvedValue(MOCK_USER);
    vi.mocked(authLib.getProjectMembership).mockResolvedValue(null);
    const res = await GET(makeRequest("GET"), makeParams());
    expect(res.status).toBe(403);
  });

  it("returns comments ordered chronologically for any member role", async () => {
    vi.mocked(authLib.getCurrentUser).mockResolvedValue(MOCK_USER);
    vi.mocked(authLib.getProjectMembership).mockResolvedValue({ role: "viewer" });
    const res = await GET(makeRequest("GET"), makeParams());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.comments).toHaveLength(1);
    expect(data.comments[0].body).toBe("Looks good to me");
  });

  it("viewers can read comments", async () => {
    vi.mocked(authLib.getCurrentUser).mockResolvedValue(MOCK_USER);
    vi.mocked(authLib.getProjectMembership).mockResolvedValue({ role: "viewer" });
    const res = await GET(makeRequest("GET"), makeParams());
    expect(res.status).toBe(200);
  });
});

describe("POST /api/tasks/:id/comments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.task.findUnique).mockResolvedValue(MOCK_TASK as never);
    vi.mocked(prisma.comment.create).mockResolvedValue(MOCK_COMMENT as never);
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(authLib.getCurrentUser).mockResolvedValue(null);
    const res = await POST(makeRequest("POST", { body: "hi" }), makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 404 when task does not exist", async () => {
    vi.mocked(authLib.getCurrentUser).mockResolvedValue(MOCK_USER);
    vi.mocked(prisma.task.findUnique).mockResolvedValue(null);
    const res = await POST(makeRequest("POST", { body: "hi" }), makeParams());
    expect(res.status).toBe(404);
  });

  it("returns 403 when user is not a project member", async () => {
    vi.mocked(authLib.getCurrentUser).mockResolvedValue(MOCK_USER);
    vi.mocked(authLib.getProjectMembership).mockResolvedValue(null);
    const res = await POST(makeRequest("POST", { body: "hi" }), makeParams());
    expect(res.status).toBe(403);
  });

  it("returns 403 when user is a viewer", async () => {
    vi.mocked(authLib.getCurrentUser).mockResolvedValue(MOCK_USER);
    vi.mocked(authLib.getProjectMembership).mockResolvedValue({ role: "viewer" });
    const res = await POST(makeRequest("POST", { body: "hi" }), makeParams());
    expect(res.status).toBe(403);
    expect(prisma.comment.create).not.toHaveBeenCalled();
  });

  it("returns 400 for an empty body", async () => {
    vi.mocked(authLib.getCurrentUser).mockResolvedValue(MOCK_USER);
    vi.mocked(authLib.getProjectMembership).mockResolvedValue({ role: "member" });
    const res = await POST(makeRequest("POST", { body: "" }), makeParams());
    expect(res.status).toBe(400);
    expect(prisma.comment.create).not.toHaveBeenCalled();
  });

  it("creates and returns a comment for a member", async () => {
    vi.mocked(authLib.getCurrentUser).mockResolvedValue(MOCK_USER);
    vi.mocked(authLib.getProjectMembership).mockResolvedValue({ role: "member" });
    const res = await POST(makeRequest("POST", { body: "Looks good to me" }), makeParams());
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.comment.body).toBe("Looks good to me");
    expect(prisma.comment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { taskId: "task-1", authorId: "user-1", body: "Looks good to me" },
      }),
    );
  });

  it("creates and returns a comment for an admin", async () => {
    vi.mocked(authLib.getCurrentUser).mockResolvedValue(MOCK_USER);
    vi.mocked(authLib.getProjectMembership).mockResolvedValue({ role: "admin" });
    const res = await POST(makeRequest("POST", { body: "Approved" }), makeParams());
    expect(res.status).toBe(201);
  });
});
