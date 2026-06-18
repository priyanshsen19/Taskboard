import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  unauthorized,
  forbidden,
  notFound,
  badRequest,
  getProjectMembership,
  canEditTasks,
} from "@/lib/auth";
import { createCommentSchema } from "@/schemas/task";
import { logActivity } from "@/lib/activity";

type Params = { params: Promise<{ id: string }> };

const AUTHOR_SELECT = { id: true, name: true, email: true };

async function resolveTask(taskId: string) {
  return prisma.task.findUnique({ where: { id: taskId }, select: { projectId: true, title: true } });
}

export async function GET(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id: taskId } = await params;
  const task = await resolveTask(taskId);
  if (!task) return notFound("task not found");

  const membership = await getProjectMembership(user.id, task.projectId);
  if (!membership) return forbidden("you are not a member of this project");

  const comments = await prisma.comment.findMany({
    where: { taskId },
    include: { author: { select: AUTHOR_SELECT } },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ comments });
}

export async function POST(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id: taskId } = await params;
  const task = await resolveTask(taskId);
  if (!task) return notFound("task not found");

  const membership = await getProjectMembership(user.id, task.projectId);
  if (!membership) return forbidden("you are not a member of this project");
  if (!canEditTasks(membership.role)) return forbidden("viewers cannot post comments");

  const body = await req.json().catch(() => null);
  const parsed = createCommentSchema.safeParse(body);
  if (!parsed.success) return badRequest("invalid input", parsed.error.flatten());

  const comment = await prisma.comment.create({
    data: { taskId, authorId: user.id, body: parsed.data.body },
    include: { author: { select: AUTHOR_SELECT } },
  });

  await logActivity({
    projectId: task.projectId,
    taskId,
    actorId: user.id,
    action: "comment_added",
    metadata: { taskTitle: task.title },
  });

  return NextResponse.json({ comment }, { status: 201 });
}
