const TERMINAL_STATUSES = new Set(["cancelled", "completed", "failed"]);

export class TaskManager {
  constructor() {
    this.tasks = new Map();
    this.activeByTab = new Map();
  }

  create({ taskId, tabId, type }) {
    const id = String(taskId || "");
    if (!id || !Number.isInteger(tabId)) {
      throw new Error("A taskId and tabId are required.");
    }
    const previous = this.getActive(tabId);
    if (previous && !TERMINAL_STATUSES.has(previous.status)) {
      this.cancel(previous.taskId);
    }
    const task = {
      taskId: id,
      tabId,
      type: String(type || "analyze"),
      status: "queued",
      createdAt: Date.now(),
      startedAt: null,
      cancelRequested: false
    };
    this.tasks.set(id, task);
    this.activeByTab.set(tabId, id);
    return task;
  }

  start(taskId) {
    return this.transition(taskId, "running", { startedAt: Date.now() });
  }

  complete(taskId) {
    return this.transition(taskId, "completed");
  }

  fail(taskId) {
    return this.transition(taskId, "failed");
  }

  cancel(taskId) {
    return this.transition(taskId, "cancelled", { cancelRequested: true });
  }

  get(taskId) {
    return this.tasks.get(String(taskId || "")) || null;
  }

  getActive(tabId) {
    const taskId = this.activeByTab.get(tabId);
    return taskId ? this.get(taskId) : null;
  }

  isActive(taskId, tabId) {
    const task = this.get(taskId);
    return Boolean(
      task &&
        task.tabId === tabId &&
        this.activeByTab.get(tabId) === task.taskId &&
        !TERMINAL_STATUSES.has(task.status)
    );
  }

  transition(taskId, status, updates = {}) {
    const task = this.get(taskId);
    if (!task || TERMINAL_STATUSES.has(task.status)) {
      return task;
    }
    Object.assign(task, updates, { status });
    if (TERMINAL_STATUSES.has(status) && this.activeByTab.get(task.tabId) === task.taskId) {
      this.activeByTab.delete(task.tabId);
    }
    return task;
  }
}
