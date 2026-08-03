import {
  KNOWLEDGE_SCHEMA_VERSION,
  createArtifact,
  createContextItem,
  createWorkspace,
  stripTransientContext
} from "./knowledge-contracts.js";

export const RETENTION_POLICIES = Object.freeze([
  "session",
  "7-days",
  "30-days",
  "forever"
]);

export function retentionCutoff(policy, now = Date.now()) {
  if (policy === "7-days") return now - 7 * 24 * 60 * 60 * 1000;
  if (policy === "30-days") return now - 30 * 24 * 60 * 60 * 1000;
  return null;
}

export function isExpired(record, policy, now = Date.now()) {
  const cutoff = retentionCutoff(policy, now);
  if (cutoff === null) return false;
  const timestamp = new Date(record.updatedAt || record.createdAt || 0).getTime();
  return !Number.isFinite(timestamp) || timestamp < cutoff;
}

export function searchWorkspaceRecords(records, query) {
  const terms = String(query || "")
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const list = Array.isArray(records) ? records : [];
  if (!terms.length) return [...list];

  return list
    .filter((record) => {
      const haystack = [
        record.title,
        record.content,
        record.text,
        record.skillId,
        record.source?.pageTitle
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
      return terms.every((term) => haystack.includes(term));
    })
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
}

export function exportWorkspaceBundle(
  { workspaces = [], contexts = [], artifacts = [], memories = [], customSkills = [] },
  options = {}
) {
  const exportedAt = options.now || new Date().toISOString();
  const safeContexts = contexts.map((context) =>
    options.includeImages === true
      ? createContextItem(context)
      : stripTransientContext(context)
  );
  return {
    product: "QuizBuddy Labs",
    schemaVersion: KNOWLEDGE_SCHEMA_VERSION,
    exportedAt,
    workspaces: workspaces.map((item) => createWorkspace(item)),
    contexts: safeContexts,
    artifacts: artifacts.map((item) => createArtifact(item)),
    memories: memories.map(sanitizeMemory),
    customSkills: customSkills.map(sanitizeCustomSkill)
  };
}

export function importWorkspaceBundle(bundle, options = {}) {
  if (!bundle || typeof bundle !== "object") {
    throw new Error("Workspace import must be a JSON object.");
  }
  if (Number(bundle.schemaVersion) > KNOWLEDGE_SCHEMA_VERSION) {
    throw new Error("Workspace export uses a newer unsupported schema.");
  }
  const now = options.now || new Date().toISOString();
  return {
    workspaces: (bundle.workspaces || []).map((item) =>
      createWorkspace(item, { now })
    ),
    contexts: (bundle.contexts || []).map((item) =>
      createContextItem(item, { now })
    ),
    artifacts: (bundle.artifacts || []).map((item) =>
      createArtifact(item, { now })
    ),
    memories: (bundle.memories || []).map(sanitizeMemory),
    customSkills: (bundle.customSkills || []).map(sanitizeCustomSkill)
  };
}

export function toMarkdownExport(workspace, contexts, artifacts) {
  const contextById = new Map(contexts.map((item) => [item.id, item]));
  const lines = [`# ${workspace.title}`, ""];
  for (const artifact of artifacts) {
    lines.push(`## ${artifact.title}`, "", artifact.content, "");
    if (artifact.sourceRefs?.length) {
      lines.push("Sources:");
      for (const sourceId of artifact.sourceRefs) {
        const source = contextById.get(sourceId);
        if (!source) continue;
        const label = source.title || source.source?.pageTitle || sourceId;
        const url = source.source?.url;
        lines.push(url ? `- [${label}](${url})` : `- ${label}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n").trim();
}

export function sanitizeMemory(input = {}) {
  return {
    id: String(input.id || "").slice(0, 160),
    label: String(input.label || "").trim().slice(0, 120),
    value: String(input.value || "").trim().slice(0, 2000),
    enabled: input.enabled !== false,
    createdAt: String(input.createdAt || ""),
    updatedAt: String(input.updatedAt || "")
  };
}

function sanitizeCustomSkill(input = {}) {
  return {
    id: String(input.id || "").slice(0, 120),
    name: String(input.name || "").slice(0, 80),
    description: String(input.description || "").slice(0, 240),
    instruction: String(input.instruction || input.promptTemplate || "").slice(
      0,
      8000
    ),
    acceptedContextTypes: Array.isArray(input.acceptedContextTypes)
      ? input.acceptedContextTypes.map(String).slice(0, 10)
      : [],
    outputType: String(input.outputType || "markdown"),
    settingsSchema:
      input.settingsSchema &&
      typeof input.settingsSchema === "object" &&
      !Array.isArray(input.settingsSchema)
        ? input.settingsSchema
        : {}
  };
}
