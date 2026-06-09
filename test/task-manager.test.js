import test from "node:test";
import assert from "node:assert/strict";
import { TaskManager } from "../lib/task-manager.js";

test("task manager transitions through queued, running, and completed", () => {
  const manager = new TaskManager();
  assert.equal(
    manager.create({ taskId: "one", tabId: 1, type: "analyze" }).status,
    "queued"
  );
  assert.equal(manager.start("one").status, "running");
  assert.equal(manager.isActive("one", 1), true);
  assert.equal(manager.complete("one").status, "completed");
  assert.equal(manager.isActive("one", 1), false);
});

test("new per-tab task cancels the previous task and stale tasks are inactive", () => {
  const manager = new TaskManager();
  manager.create({ taskId: "old", tabId: 1, type: "analyze" });
  manager.start("old");
  manager.create({ taskId: "new", tabId: 1, type: "followup" });
  assert.equal(manager.get("old").status, "cancelled");
  assert.equal(manager.get("old").cancelRequested, true);
  assert.equal(manager.isActive("old", 1), false);
  assert.equal(manager.isActive("new", 1), true);
});
