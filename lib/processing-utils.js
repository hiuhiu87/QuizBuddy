export function calculateCropPixels(rect, imageWidth, imageHeight) {
  const viewportWidth = Number(rect.viewportWidth);
  const viewportHeight = Number(rect.viewportHeight);
  const fallbackScale = Number(rect.devicePixelRatio) || 1;
  const scaleX =
    viewportWidth > 0 ? imageWidth / viewportWidth : fallbackScale;
  const scaleY =
    viewportHeight > 0 ? imageHeight / viewportHeight : fallbackScale;

  const sx = clamp(Math.round(rect.x * scaleX), 0, imageWidth);
  const sy = clamp(Math.round(rect.y * scaleY), 0, imageHeight);
  const right = clamp(
    Math.round((rect.x + rect.width) * scaleX),
    sx,
    imageWidth
  );
  const bottom = clamp(
    Math.round((rect.y + rect.height) * scaleY),
    sy,
    imageHeight
  );

  return {
    sx,
    sy,
    sw: right - sx,
    sh: bottom - sy
  };
}

export function normalizeOCRText(text) {
  return String(text || "")
    .normalize("NFC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseAIResult(content, ocrText = "") {
  const fallback = {
    answerText: "Unknown",
    answerLabel: "",
    confidence: "low",
    shortExplanation: "Could not parse the local AI response.",
    coreKnowledge: "",
    notes: "Please try cropping the question more clearly."
  };

  try {
    const source = String(content || "").trim();
    const fenced = source
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    const firstBrace = fenced.indexOf("{");
    const lastBrace = fenced.lastIndexOf("}");
    const json =
      firstBrace >= 0 && lastBrace > firstBrace
        ? fenced.slice(firstBrace, lastBrace + 1)
        : fenced;
    const parsed = JSON.parse(json);
    const legacyAnswer = cleanField(parsed.answer);
    const answerLabel = normalizeAnswerLabel(
      parsed.answerLabel,
      legacyAnswer,
      ocrText
    );
    const rawAnswerText =
      cleanField(parsed.answerText) || extractLegacyAnswerText(legacyAnswer);
    const answerText =
      resolveAnswerText(rawAnswerText, answerLabel, ocrText) || "Unknown";

    return {
      answerText,
      answerLabel,
      confidence: normalizeConfidence(parsed.confidence),
      shortExplanation: cleanField(parsed.shortExplanation),
      coreKnowledge: cleanField(parsed.coreKnowledge),
      notes: cleanField(parsed.notes)
    };
  } catch {
    return fallback;
  }
}

function normalizeAnswerLabel(value, legacyAnswer, ocrText) {
  const candidate =
    cleanField(value).match(/^[A-Z0-9]{1,3}$/i)?.[0] ||
    cleanField(legacyAnswer).match(
      /^(?:option|answer)?\s*([A-Z0-9]{1,3})(?:[.):\-\s]|$)/i
    )?.[1] ||
    "";

  if (!candidate || !ocrHasChoiceLabel(ocrText, candidate)) {
    return "";
  }

  return candidate.toUpperCase();
}

function extractLegacyAnswerText(value) {
  const answer = cleanField(value);
  if (!answer || /^(?:unknown|[A-D]|option\s+[A-D])$/i.test(answer)) {
    return "";
  }

  return answer.replace(/^(?:option|answer)?\s*[A-Z0-9]{1,3}[.):\-]\s*/i, "");
}

function resolveAnswerText(value, label, ocrText) {
  const answerText = cleanField(value);
  const isLabelOnly =
    label &&
    new RegExp(`^(?:option\\s+)?${escapeRegExp(label)}$`, "i").test(
      answerText
    );

  if (isLabelOnly || (!answerText && label)) {
    return extractChoiceText(ocrText, label);
  }

  return answerText;
}

function extractChoiceText(ocrText, label) {
  const pattern = new RegExp(
    `(?:^|\\n)\\s*${escapeRegExp(label)}\\s*[.):\\-]\\s*(.+)`,
    "im"
  );
  return cleanField(String(ocrText || "").match(pattern)?.[1]);
}

function ocrHasChoiceLabel(ocrText, label) {
  const pattern = new RegExp(
    `(?:^|\\n)\\s*${escapeRegExp(label)}\\s*[.):\\-]\\s*\\S`,
    "im"
  );
  return pattern.test(String(ocrText || ""));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeConfidence(value) {
  const confidence = cleanField(value).toLowerCase();
  return ["low", "medium", "high"].includes(confidence) ? confidence : "low";
}

function cleanField(value) {
  return String(value || "").trim();
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
