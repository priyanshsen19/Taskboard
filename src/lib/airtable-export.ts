import Airtable from "airtable";

export type TaskExportFields = {
  Name: string;
  Status: string;
  Notes: string;
  Assignee: string;
  "Taskboard TaskID": string;
  Project: string;
  "Created At": string;
};

export type ExportResult = {
  created: number;
  updated: number;
  failed: number;
  errors: Array<{ taskId: string; message: string }>;
};

export type ExportableTask = {
  id: string;
  title: string;
  status: string;
  description: string | null;
  projectId: string;
  createdAt: Date | string;
  assignee?: { name: string } | null;
};

/**
 * Injectable client interface — RealAirtableClient in production,
 * MockAirtableAdapter in unit tests.
 */
export interface AirtableExportClient {
  /** Returns a map of taskboard task ID → Airtable record ID for all existing records. */
  getExistingRecordMap(): Promise<Map<string, string>>;
  create(fields: TaskExportFields): Promise<void>;
  update(airtableRecordId: string, fields: TaskExportFields): Promise<void>;
}

// ─── retry ───────────────────────────────────────────────────────────────────

function isTransient(err: unknown): boolean {
  const code = (err as { statusCode?: number })?.statusCode;
  // 429 rate-limit, 5xx server errors, and missing status (network) are transient
  if (code === 429 || (code !== undefined && code >= 500)) return true;
  if (code === undefined) return true;
  return false;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransient(err) || attempt === maxAttempts) throw err;
      await sleep(Math.pow(2, attempt - 1) * 1000); // 1 s, 2 s
    }
  }
  throw lastErr;
}

// ─── export orchestration ────────────────────────────────────────────────────

export async function exportTasks(
  tasks: ExportableTask[],
  client: AirtableExportClient,
): Promise<ExportResult> {
  const existingMap = await client.getExistingRecordMap();
  const result: ExportResult = { created: 0, updated: 0, failed: 0, errors: [] };

  for (const task of tasks) {
    const fields: TaskExportFields = {
      Name: task.title,
      Status: task.status,
      Notes: task.description ?? "",
      Assignee: task.assignee?.name ?? "",
      "Taskboard TaskID": task.id,
      Project: task.projectId,
      "Created At": new Date(task.createdAt).toISOString(),
    };

    try {
      const existingId = existingMap.get(task.id);
      if (existingId) {
        await withRetry(() => client.update(existingId, fields));
        result.updated++;
      } else {
        await withRetry(() => client.create(fields));
        result.created++;
      }
    } catch (err) {
      result.failed++;
      result.errors.push({
        taskId: task.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

// ─── real Airtable adapter ───────────────────────────────────────────────────

export class RealAirtableClient implements AirtableExportClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private table: Airtable.Table<any>;

  constructor() {
    const key = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;
    const tableName = process.env.AIRTABLE_TABLE_NAME;
    if (!key || !baseId || !tableName) {
      throw new Error("Missing AIRTABLE_API_KEY, AIRTABLE_BASE_ID, or AIRTABLE_TABLE_NAME");
    }
    this.table = new Airtable({ apiKey: key }).base(baseId)(tableName);
  }

  async getExistingRecordMap(): Promise<Map<string, string>> {
    const records = await this.table.select({ fields: ["Taskboard TaskID"] }).all();
    const map = new Map<string, string>();
    for (const r of records) {
      const taskId = r.fields["Taskboard TaskID"] as string | undefined;
      if (taskId) map.set(taskId, r.id);
    }
    return map;
  }

  async create(fields: TaskExportFields): Promise<void> {
    await this.table.create(fields);
  }

  async update(airtableRecordId: string, fields: TaskExportFields): Promise<void> {
    await this.table.update(airtableRecordId, fields);
  }
}
