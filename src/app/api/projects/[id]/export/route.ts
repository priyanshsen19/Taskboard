import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  unauthorized,
  forbidden,
  getProjectMembership,
  canEditTasks,
} from "@/lib/auth";
import { exportTasks, RealAirtableClient } from "@/lib/airtable-export";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id: projectId } = await params;
  const membership = await getProjectMembership(user.id, projectId);
  if (!membership) return forbidden("you are not a member of this project");
  if (!canEditTasks(membership.role)) return forbidden("viewers cannot export tasks");

  const tasks = await prisma.task.findMany({
    where: { projectId },
    include: { assignee: { select: { name: true } } },
  });

  if (tasks.length === 0) {
    return NextResponse.json({ message: "no tasks to export", created: 0, updated: 0, failed: 0, errors: [] });
  }

  let client: RealAirtableClient;
  try {
    client = new RealAirtableClient();
  } catch {
    return NextResponse.json({ error: "Airtable is not configured on this server" }, { status: 503 });
  }

  const result = await exportTasks(tasks, client);

  return NextResponse.json({
    message: `export complete: ${result.created} created, ${result.updated} updated, ${result.failed} failed`,
    ...result,
  });
}
