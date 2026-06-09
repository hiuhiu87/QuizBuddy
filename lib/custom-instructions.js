export const CUSTOM_INSTRUCTIONS_KEY = "quizbuddyCustomInstructions";
export const MAX_CUSTOM_INSTRUCTION_LENGTH = 2000;

export const CUSTOM_INSTRUCTION_TEMPLATES = [
  { id: "german-vietnamese", label: "German tutor in Vietnamese", text: "Explain German grammar in Vietnamese and include concise examples." },
  { id: "law-irac", label: "Law IRAC explanation", text: "Explain legal questions using concise Issue, Rule, Application, and Conclusion sections." },
  { id: "math-steps", label: "Math step-by-step", text: "Show concise calculation steps and verify the final result." },
  { id: "quick-exam", label: "Quick exam answer", text: "Prioritize the direct answer and keep the explanation brief." },
  { id: "beginner", label: "Explain like beginner", text: "Use simple language and one easy example." }
];

export function normalizeCustomInstructions(value) {
  const source = value && typeof value === "object" ? value : {};
  const bySubject =
    source.bySubject && typeof source.bySubject === "object"
      ? Object.fromEntries(
          Object.entries(source.bySubject)
            .map(([subject, instruction]) => [
              String(subject),
              normalizeInstruction(instruction)
            ])
            .filter(([, instruction]) => instruction)
        )
      : {};

  return {
    enabled: source.enabled === true,
    global: normalizeInstruction(source.global),
    bySubject,
    updatedAt: Number.isFinite(source.updatedAt) ? source.updatedAt : 0
  };
}

export function resolveCustomInstruction(value, subject) {
  const normalized = normalizeCustomInstructions(value);
  if (!normalized.enabled) {
    return "";
  }
  return normalizeInstruction(normalized.bySubject[String(subject || "")]) || normalized.global;
}

export function updateCustomInstruction(
  value,
  { instruction, scope = "global", subject = "auto", enabled = true } = {}
) {
  const normalized = normalizeCustomInstructions(value);
  const text = normalizeInstruction(instruction);
  if (scope === "subject") {
    normalized.bySubject[String(subject || "auto")] = text;
  } else {
    normalized.global = text;
  }
  return { ...normalized, enabled: Boolean(enabled), updatedAt: Date.now() };
}

function normalizeInstruction(value) {
  return String(value || "").trim().slice(0, MAX_CUSTOM_INSTRUCTION_LENGTH);
}
