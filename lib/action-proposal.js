const ALLOWED_ACTION_TYPES = new Set(["checklist", "form-draft"]);

export function createActionProposal(input = {}, options = {}) {
  const actionType = ALLOWED_ACTION_TYPES.has(input.actionType)
    ? input.actionType
    : "checklist";
  const steps = (Array.isArray(input.steps) ? input.steps : [])
    .map((step) => ({
      label: String(step?.label || step || "").trim().slice(0, 300),
      value: String(step?.value || "").trim().slice(0, 2000),
      risk: ["low", "medium", "high"].includes(step?.risk)
        ? step.risk
        : "low"
    }))
    .filter((step) => step.label)
    .slice(0, 50);
  if (!steps.length) {
    throw new Error("Action proposal requires at least one reviewable step.");
  }

  return {
    schemaVersion: 1,
    id:
      String(input.id || "") ||
      `action_${options.idFactory?.() || globalThis.crypto?.randomUUID?.() || Date.now()}`,
    actionType,
    title: String(input.title || "Proposed action").trim().slice(0, 160),
    summary: String(input.summary || "").trim().slice(0, 2000),
    steps,
    risks: (Array.isArray(input.risks) ? input.risks : [])
      .map(String)
      .map((risk) => risk.trim().slice(0, 300))
      .filter(Boolean)
      .slice(0, 20),
    status: "proposed",
    requiresConfirmation: true,
    executionAllowed: false,
    createdAt: options.now || new Date().toISOString()
  };
}

export function parseActionProposal(content) {
  let parsed;
  try {
    parsed = JSON.parse(String(content || ""));
  } catch {
    throw new Error("Action proposal must be valid JSON.");
  }
  return createActionProposal({
    actionType: parsed.actionType || "checklist",
    title: parsed.title,
    summary: parsed.summary,
    risks: parsed.risks,
    steps: parsed.steps
  });
}
