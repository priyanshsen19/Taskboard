"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, getStoredUser } from "@/lib/api-client";
import type { ApiComment, ApiTask, ApiProjectMember, TaskStatus } from "@/types";
import { STATUS_LABELS, STATUS_ORDER } from "@/types";

type Props = {
  task: ApiTask;
  projectId: string;
  members: ApiProjectMember[];
  onClose: () => void;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TaskDetail({ task, projectId, members, onClose }: Props) {
  const queryClient = useQueryClient();
  const currentUser = getStoredUser();

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [assigneeId, setAssigneeId] = useState<string>(task.assigneeId ?? "");
  const [taskError, setTaskError] = useState<string | null>(null);

  const [commentBody, setCommentBody] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);

  const myRole = members.find((m) => m.user.id === currentUser?.id)?.role;
  const canComment = myRole === "admin" || myRole === "member";

  const { data: commentsData } = useQuery({
    queryKey: ["comments", task.id],
    queryFn: () =>
      apiFetch<{ comments: ApiComment[] }>(`/api/tasks/${task.id}/comments`),
  });

  const comments = commentsData?.comments ?? [];

  const updateTask = useMutation({
    mutationFn: (input: Partial<ApiTask>) =>
      apiFetch<{ task: ApiTask }>(`/api/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      onClose();
    },
    onError: (err) => setTaskError(err instanceof Error ? err.message : "save failed"),
  });

  const deleteTask = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: true }>(`/api/tasks/${task.id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      onClose();
    },
    onError: (err) => setTaskError(err instanceof Error ? err.message : "delete failed"),
  });

  const postComment = useMutation({
    mutationFn: (body: string) =>
      apiFetch<{ comment: ApiComment }>(`/api/tasks/${task.id}/comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
      }),
    onSuccess: () => {
      setCommentBody("");
      setCommentError(null);
      queryClient.invalidateQueries({ queryKey: ["comments", task.id] });
    },
    onError: (err) =>
      setCommentError(err instanceof Error ? err.message : "post failed"),
  });

  function onSave() {
    setTaskError(null);
    updateTask.mutate({ title, description, status, assigneeId: assigneeId || null });
  }

  function onPostComment(e: React.FormEvent) {
    e.preventDefault();
    if (!commentBody.trim()) return;
    setCommentError(null);
    postComment.mutate(commentBody.trim());
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center px-4 z-50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-surface border border-border rounded-lg flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* scrollable body */}
        <div className="overflow-y-auto p-6 flex-1">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">edit task</h2>
            <button onClick={onClose} className="text-muted hover:text-white">
              ✕
            </button>
          </div>

          <label className="block mb-3">
            <span className="text-xs text-muted">title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 block w-full rounded-md bg-bg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
          </label>

          <label className="block mb-3">
            <span className="text-xs text-muted">description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="mt-1 block w-full rounded-md bg-bg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
          </label>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <label className="block">
              <span className="text-xs text-muted">status</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as TaskStatus)}
                className="mt-1 block w-full rounded-md bg-bg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
              >
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs text-muted">assignee</span>
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="mt-1 block w-full rounded-md bg-bg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
              >
                <option value="">unassigned</option>
                {members.map((m) => (
                  <option key={m.user.id} value={m.user.id}>
                    {m.user.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {taskError && (
            <p className="text-sm text-red-400 mb-3" role="alert">
              {taskError}
            </p>
          )}

          <div className="flex items-center justify-between gap-3 mb-6">
            <button
              onClick={() => deleteTask.mutate()}
              disabled={deleteTask.isPending}
              className="text-sm text-red-400 hover:text-red-300"
            >
              delete task
            </button>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="text-sm px-4 py-2 rounded-md border border-border hover:border-muted"
              >
                cancel
              </button>
              <button
                onClick={onSave}
                disabled={updateTask.isPending}
                className="text-sm px-4 py-2 rounded-md bg-accent text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {updateTask.isPending ? "saving…" : "save"}
              </button>
            </div>
          </div>

          {/* comments */}
          <div className="border-t border-border pt-5">
            <h3 className="text-sm font-medium mb-3">
              comments
              {comments.length > 0 && (
                <span className="ml-2 text-xs text-muted">{comments.length}</span>
              )}
            </h3>

            {comments.length === 0 ? (
              <p className="text-xs text-muted mb-4">no comments yet</p>
            ) : (
              <ul className="space-y-3 mb-4">
                {comments.map((c) => (
                  <li key={c.id} className="bg-bg rounded-md px-3 py-2">
                    <div className="flex items-baseline justify-between mb-1">
                      <span className="text-xs font-medium">{c.author.name}</span>
                      <span className="text-xs text-muted">{formatDate(c.createdAt)}</span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{c.body}</p>
                  </li>
                ))}
              </ul>
            )}

            {canComment ? (
              <form onSubmit={onPostComment} className="space-y-2">
                <textarea
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  placeholder="add a comment…"
                  rows={2}
                  className="block w-full rounded-md bg-bg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none resize-none"
                />
                {commentError && (
                  <p className="text-xs text-red-400" role="alert">
                    {commentError}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={postComment.isPending || !commentBody.trim()}
                  className="text-sm px-4 py-2 rounded-md bg-accent text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {postComment.isPending ? "posting…" : "post comment"}
                </button>
              </form>
            ) : (
              <p className="text-xs text-muted italic">
                viewers can read comments but cannot post.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
