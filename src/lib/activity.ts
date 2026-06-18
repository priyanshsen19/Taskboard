import { prisma } from "./prisma";

export type ActivityAction =
  | "task_created"
  | "status_changed"
  | "assignee_changed"
  | "comment_added";

export async function logActivity(params: {
  projectId: string;
  taskId: string;
  actorId: string;
  action: ActivityAction;
  metadata: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.activityLog.create({ data: params });
  } catch (err) {
    console.error("[activity] failed to log", params.action, err);
  }
}
