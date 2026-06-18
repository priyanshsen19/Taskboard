import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/tasks/[id]/route";
import { prisma } from "@/lib/prisma";
import * as authLib from "@/lib/auth";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: { findUnique: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn() },
    activityLog: { create: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getCurrentUser: vi.fn(),
    getProjectMembership: vi.fn(),
  };
});

const MOCK_USER = { id: "user-1", email: "a@b.com", name: "Alice" };
const MOCK_TASK = { id: "task-1", projectId: "project-other", title: "Original" };

function makeRequest(body: object = { title: "Updated" }) {
  return new NextRequest("http://localhost/api/tasks/task-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeParams(id = "task-1") {
  return { params: Promise.resolve({ id }) };
}

describe("PATCH /api/tasks/:id — authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.task.findUnique).mockResolvedValue(MOCK_TASK as never);
    vi.mocked(prisma.task.update).mockResolvedValue({
      ...MOCK_TASK,
      title: "Updated",
      assignee: null,
    } as never);
  });

  it("returns 401 when no token is provided", async () => {
    vi.mocked(authLib.getCurrentUser).mockResolvedValue(null);

    const res = await PATCH(makeRequest(), makeParams());

    expect(res.status).toBe(401);
    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  it("returns 403 when the user has no membership in the task's project", async () => {
    vi.mocked(authLib.getCurrentUser).mockResolvedValue(MOCK_USER);
    vi.mocked(authLib.getProjectMembership).mockResolvedValue(null);

    const res = await PATCH(makeRequest(), makeParams());

    expect(res.status).toBe(403);
    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  it("returns 403 when the user's role is viewer", async () => {
    vi.mocked(authLib.getCurrentUser).mockResolvedValue(MOCK_USER);
    vi.mocked(authLib.getProjectMembership).mockResolvedValue({ role: "viewer" });

    const res = await PATCH(makeRequest(), makeParams());

    expect(res.status).toBe(403);
    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  it("allows update when the user is a member", async () => {
    vi.mocked(authLib.getCurrentUser).mockResolvedValue(MOCK_USER);
    vi.mocked(authLib.getProjectMembership).mockResolvedValue({ role: "member" });

    const res = await PATCH(makeRequest(), makeParams());

    expect(res.status).toBe(200);
    expect(prisma.task.update).toHaveBeenCalledOnce();
  });

  it("allows update when the user is an admin", async () => {
    vi.mocked(authLib.getCurrentUser).mockResolvedValue(MOCK_USER);
    vi.mocked(authLib.getProjectMembership).mockResolvedValue({ role: "admin" });

    const res = await PATCH(makeRequest(), makeParams());

    expect(res.status).toBe(200);
    expect(prisma.task.update).toHaveBeenCalledOnce();
  });

  it("checks membership against the task's project, not a user-supplied one", async () => {
    vi.mocked(authLib.getCurrentUser).mockResolvedValue(MOCK_USER);
    vi.mocked(authLib.getProjectMembership).mockResolvedValue(null);

    await PATCH(makeRequest(), makeParams());

    expect(authLib.getProjectMembership).toHaveBeenCalledWith(
      MOCK_USER.id,
      MOCK_TASK.projectId,
    );
  });
});
