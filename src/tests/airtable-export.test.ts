import { describe, it, expect, beforeEach } from "vitest";
import { AirtableMockClient, AirtableError } from "@/lib/airtable-mock";
import { exportTasks, type AirtableExportClient, type TaskExportFields, type ExportableTask } from "@/lib/airtable-export";

// ─── adapter: wraps AirtableMockClient behind AirtableExportClient ────────────

class MockAdapter implements AirtableExportClient {
  constructor(private mock: AirtableMockClient) {}

  async getExistingRecordMap(): Promise<Map<string, string>> {
    const records = await this.mock.list();
    return new Map(records.map((r) => [r.fields["Taskboard TaskID"] as string, r.id]));
  }

  async create(fields: TaskExportFields): Promise<void> {
    await this.mock.create({ id: fields["Taskboard TaskID"], fields });
  }

  async update(airtableRecordId: string, fields: TaskExportFields): Promise<void> {
    await this.mock.update(airtableRecordId, fields);
  }
}

// ─── fixtures ─────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<ExportableTask> = {}): ExportableTask {
  return {
    id: "task-1",
    title: "Write tests",
    status: "todo",
    description: "Make it green",
    projectId: "project-1",
    createdAt: "2026-01-01T10:00:00.000Z",
    assignee: { name: "Alice" },
    ...overrides,
  };
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe("exportTasks", () => {
  let mock: AirtableMockClient;
  let adapter: MockAdapter;

  beforeEach(() => {
    mock = new AirtableMockClient();
    adapter = new MockAdapter(mock);
  });

  it("creates a record for each task on the first run", async () => {
    const tasks = [makeTask({ id: "t-1" }), makeTask({ id: "t-2" })];
    const result = await exportTasks(tasks, adapter);

    expect(result.created).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.failed).toBe(0);
    expect(mock.__getRecordCount()).toBe(2);
  });

  it("maps task fields correctly", async () => {
    await exportTasks([makeTask()], adapter);
    const [record] = mock.__getRecords();
    expect(record.fields).toMatchObject({
      Name: "Write tests",
      Status: "todo",
      Notes: "Make it green",
      Assignee: "Alice",
      "Taskboard TaskID": "task-1",
      Project: "project-1",
    });
  });

  it("idempotent — updates existing records on second run instead of creating duplicates", async () => {
    const tasks = [makeTask({ id: "t-1", title: "Original" })];
    await exportTasks(tasks, adapter);

    const updated = [makeTask({ id: "t-1", title: "Updated" })];
    const result = await exportTasks(updated, adapter);

    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);
    expect(mock.__getRecordCount()).toBe(1); // still only one record
    expect(mock.__getRecords()[0].fields["Name"]).toBe("Updated");
  });

  it("handles null assignee and description gracefully", async () => {
    await exportTasks([makeTask({ assignee: null, description: null })], adapter);
    const [record] = mock.__getRecords();
    expect(record.fields["Assignee"]).toBe("");
    expect(record.fields["Notes"]).toBe("");
  });

  it("does not fail the whole export when a single record has a permanent error", async () => {
    const tasks = [makeTask({ id: "t-1" }), makeTask({ id: "t-2" }), makeTask({ id: "t-3" })];

    // Make the adapter fail permanently on t-2 only
    const faultyAdapter: AirtableExportClient = {
      getExistingRecordMap: () => Promise.resolve(new Map()),
      create: async (fields) => {
        if (fields["Taskboard TaskID"] === "t-2") {
          throw new AirtableError("invalid field", "server-error", 422);
        }
        await adapter.create(fields);
      },
      update: adapter.update.bind(adapter),
    };

    const result = await exportTasks(tasks, faultyAdapter);

    expect(result.created).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.errors[0].taskId).toBe("t-2");
  });

  it("retries transient errors and succeeds on eventual success", async () => {
    let attempts = 0;
    const flaky: AirtableExportClient = {
      getExistingRecordMap: () => Promise.resolve(new Map()),
      create: async (fields) => {
        attempts++;
        if (attempts < 3) throw new AirtableError("rate limited", "rate-limit", 429);
        await adapter.create(fields);
      },
      update: adapter.update.bind(adapter),
    };

    const result = await exportTasks([makeTask()], flaky);

    expect(result.created).toBe(1);
    expect(result.failed).toBe(0);
    expect(attempts).toBe(3);
  });

  it("does not retry permanent errors", async () => {
    let attempts = 0;
    const permanent: AirtableExportClient = {
      getExistingRecordMap: () => Promise.resolve(new Map()),
      create: async () => {
        attempts++;
        throw new AirtableError("bad field name", "server-error", 422);
      },
      update: adapter.update.bind(adapter),
    };

    const result = await exportTasks([makeTask()], permanent);

    expect(result.failed).toBe(1);
    expect(attempts).toBe(1); // tried exactly once, no retry
  });

  it("returns empty result with no tasks", async () => {
    const result = await exportTasks([], adapter);
    expect(result).toEqual({ created: 0, updated: 0, failed: 0, errors: [] });
  });
});
