export const KNOWLEDGE_SCHEMA_VERSION = 1;
export const SKILL_PROTOCOL_VERSION = 1;

export const CONTEXT_TYPES = Object.freeze([
  "selection",
  "crop",
  "page",
  "image",
  "artifact"
]);

export const ARTIFACT_FORMATS = Object.freeze([
  "markdown",
  "json",
  "table"
]);

const VALID_CONTEXT_TYPES = new Set(CONTEXT_TYPES);
const VALID_ARTIFACT_FORMATS = new Set(ARTIFACT_FORMATS);

export function createContextItem(input = {}, options = {}) {
  const now = options.now || new Date().toISOString();
  const type = VALID_CONTEXT_TYPES.has(input.type) ? input.type : "selection";
  const text = String(input.text || "").trim();
  const imageDataUrl = normalizeImageDataUrl(input.imageDataUrl);

  if (!text && !imageDataUrl) {
    throw new Error("Context must include text or an image.");
  }

  return {
    schemaVersion: KNOWLEDGE_SCHEMA_VERSION,
    id: normalizeId(input.id, options.idFactory, "ctx"),
    type,
    title: String(input.title || defaultContextTitle(type)).trim().slice(0, 160),
    text: text.slice(0, 120000),
    ...(imageDataUrl ? { imageDataUrl } : {}),
    source: {
      url: normalizeHttpUrl(input.source?.url),
      pageTitle: String(input.source?.pageTitle || "").trim().slice(0, 300),
      capturedAt: normalizeDate(input.source?.capturedAt, now)
    },
    metadata: normalizePlainObject(input.metadata)
  };
}

export function createArtifact(input = {}, options = {}) {
  const now = options.now || new Date().toISOString();
  const content =
    typeof input.content === "string"
      ? input.content.trim()
      : JSON.stringify(input.content ?? "", null, 2);
  if (!content) {
    throw new Error("Artifact content is required.");
  }

  return {
    schemaVersion: KNOWLEDGE_SCHEMA_VERSION,
    id: normalizeId(input.id, options.idFactory, "art"),
    workspaceId: String(input.workspaceId || "").trim(),
    skillId: String(input.skillId || "").trim(),
    title: String(input.title || "Untitled artifact").trim().slice(0, 160),
    content,
    format: VALID_ARTIFACT_FORMATS.has(input.format)
      ? input.format
      : "markdown",
    sourceRefs: normalizeStringArray(input.sourceRefs),
    provider: input.provider === "openai" ? "openai" : "local",
    pinned: input.pinned === true,
    createdAt: normalizeDate(input.createdAt, now),
    updatedAt: normalizeDate(input.updatedAt, now),
    metadata: normalizePlainObject(input.metadata)
  };
}

export function createWorkspace(input = {}, options = {}) {
  const now = options.now || new Date().toISOString();
  return {
    schemaVersion: KNOWLEDGE_SCHEMA_VERSION,
    id: normalizeId(input.id, options.idFactory, "ws"),
    title: String(input.title || "New workspace").trim().slice(0, 160),
    contextIds: normalizeStringArray(input.contextIds),
    artifactIds: normalizeStringArray(input.artifactIds),
    createdAt: normalizeDate(input.createdAt, now),
    updatedAt: normalizeDate(input.updatedAt, now),
    metadata: normalizePlainObject(input.metadata)
  };
}

export function validateRunSkillTask(message = {}) {
  if (message.type !== "QB_RUN_SKILL") {
    throw new Error("Unsupported task type.");
  }
  if (message.protocolVersion !== SKILL_PROTOCOL_VERSION) {
    throw new Error("Unsupported skill protocol version.");
  }
  const taskId = String(message.taskId || "").trim();
  const skillId = String(message.skillId || "").trim();
  if (!taskId || !skillId) {
    throw new Error("Skill task requires taskId and skillId.");
  }
  const rawContext = Array.isArray(message.context)
    ? message.context
    : [message.context];
  const context = rawContext.filter(Boolean).map((item) => createContextItem(item));
  if (!context.length) {
    throw new Error("Skill task requires at least one context item.");
  }

  return {
    type: "QB_RUN_SKILL",
    protocolVersion: SKILL_PROTOCOL_VERSION,
    taskId,
    skillId,
    context,
    settings: normalizePlainObject(message.settings),
    profile: normalizePlainObject(message.profile),
    provider: message.provider === "openai" ? "openai" : "local",
    modelId: String(message.modelId || ""),
    openaiBaseUrl: String(message.openaiBaseUrl || ""),
    openaiApiKey: String(message.openaiApiKey || ""),
    openaiModel: String(message.openaiModel || "")
  };
}

export function stripTransientContext(context) {
  const { imageDataUrl: _imageDataUrl, ...persistent } = createContextItem(context);
  return persistent;
}

export function normalizeHttpUrl(value) {
  const source = String(value || "").trim();
  if (!source) return "";
  try {
    const url = new URL(source);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : "";
  } catch {
    return "";
  }
}

function normalizeId(value, idFactory, prefix) {
  const candidate = String(value || "").trim();
  if (candidate) return candidate.slice(0, 160);
  const generated =
    typeof idFactory === "function"
      ? idFactory()
      : globalThis.crypto?.randomUUID?.() ||
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${generated}`;
}

function normalizeDate(value, fallback) {
  const date = new Date(value || fallback);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function normalizeStringArray(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(String))]
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 500);
}

function normalizePlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => isJsonValue(item))
      .slice(0, 100)
  );
}

function isJsonValue(value) {
  if (value === null) return true;
  if (["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (value && typeof value === "object") {
    return Object.values(value).every(isJsonValue);
  }
  return false;
}

function normalizeImageDataUrl(value) {
  const source = String(value || "");
  return /^data:image\/(?:png|jpe?g|webp);base64,/i.test(source) ? source : "";
}

function defaultContextTitle(type) {
  return {
    selection: "Selected text",
    crop: "Screen capture",
    page: "Current page",
    image: "Image",
    artifact: "Saved artifact"
  }[type];
}
