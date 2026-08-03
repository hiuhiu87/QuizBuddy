const ALLOWED_EVENTS = new Set([
  "skill_started",
  "skill_completed",
  "skill_failed",
  "skill_retried",
  "artifact_saved",
  "workspace_exported",
  "task_cancelled"
]);

export function createMetricEvent(input = {}, options = {}) {
  const name = ALLOWED_EVENTS.has(input.name) ? input.name : "skill_failed";
  return {
    id:
      String(input.id || "") ||
      `metric_${options.idFactory?.() || globalThis.crypto?.randomUUID?.() || Date.now()}`,
    name,
    skillId: String(input.skillId || "").slice(0, 120),
    provider: input.provider === "openai" ? "openai" : "local",
    durationMs: Math.max(0, Math.round(Number(input.durationMs) || 0)),
    success: input.success === true,
    createdAt: options.now || new Date().toISOString()
  };
}

export function aggregateMetrics(events = []) {
  const result = {
    total: 0,
    completed: 0,
    failed: 0,
    averageDurationMs: 0,
    bySkill: {}
  };
  let durationTotal = 0;
  let durationCount = 0;
  for (const event of events) {
    result.total += 1;
    if (event.name === "skill_completed") result.completed += 1;
    if (event.name === "skill_failed") result.failed += 1;
    if (event.durationMs > 0) {
      durationTotal += event.durationMs;
      durationCount += 1;
    }
    if (event.skillId) {
      result.bySkill[event.skillId] = (result.bySkill[event.skillId] || 0) + 1;
    }
  }
  result.averageDurationMs = durationCount
    ? Math.round(durationTotal / durationCount)
    : 0;
  return result;
}
