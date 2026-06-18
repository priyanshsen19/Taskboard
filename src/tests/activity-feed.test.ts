import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/projects/[id]/activity/route";
import { prisma } from "@/lib/prisma";
import * as authLib from "@/lib/auth";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    activityLog: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getCurrentUser: vi.fn(), getProjectMembership: vi.fn() };
});

const MOCK_USER = { id: "user-1", email: "a@b.com", name: "Alice" };
const MOCK_LOG = {
  id: "log-1",
  action: "task_created",
  metadata: { taskTitle: "Fix bug" },
  createdAt: new Date("2026-01-01T10:00:00Z"),
  actor: { id: "user-1", name: "Alice", email: "a@b.com" },
  task: { id: "task-1", title: "Fix bug" },
};

function makeRequest() {
  return new NextRequest("http://localhost/api/projects/project-1/activity");
}
function makeParams(id = "project-1") {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/projects/:id/activity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.activityLog.findMany).mockResolvedValue([MOCK_LOG] as never);
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(authLib.getCurrentUser).mockResolvedValue(null);
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 403 when user is not a project member", async () => {
    vi.mocked(authLib.getCurrentUser).mockResolvedValue(MOCK_USER);
    vi.mocked(authLib.getProjectMembership).mockResolvedValue(null);
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(403);
  });

  it("returns logs for any project member including viewer", async () => {
    vi.mocked(authLib.getCurrentUser).mockResolvedValue(MOCK_USER);
    vi.mocked(authLib.getProjectMembership).mockResolvedValue({ role: "viewer" });
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.logs).toHaveLength(1);
    expect(data.logs[0].action).toBe("task_created");
  });

  it("queries with desc order and limit 50", async () => {
    vi.mocked(authLib.getCurrentUser).mockResolvedValue(MOCK_USER);
    vi.mocked(authLib.getProjectMembership).mockResolvedValue({ role: "member" });
    await GET(makeRequest(), makeParams());
    expect(prisma.activityLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    );
  });

  it("scopes query to the requested project", async () => {
    vi.mocked(authLib.getCurrentUser).mockResolvedValue(MOCK_USER);
    vi.mocked(authLib.getProjectMembership).mockResolvedValue({ role: "admin" });
    await GET(makeRequest(), makeParams("project-99"));
    expect(prisma.activityLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: "project-99" } }),
    );
  });
});
