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
  const normalized = String(text || "")
    .normalize("NFC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r\n?/g, "\n");

  return normalizeOCRChoiceMarkers(normalized)
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeOCRChoiceMarkers(text) {
  return String(text || "").replace(
    /(^|[ \t\n]+)(?:[O0○◯●]\s*)?([A-D])\s*[.)]\s*/gi,
    (match, prefix, label) =>
      `${prefix ? "\n" : ""}${label.toUpperCase()}. `
  );
}

export function parseAIResult(
  content,
  ocrText = "",
  {
    requestedMode = "learning",
    userSelectedAnswer = ""
  } = {}
) {
  const fallback = {
    mode: requestedMode === "quick" ? "quick" : "learning",
    answerText: "Unknown",
    answerLabel: "",
    confidence: "low",
    shortExplanation: "Could not parse the local AI response.",
    coreKnowledge: "",
    notes: "Please try cropping the question more clearly.",
    optionAnalysis: [],
    miniExample: null,
    userAnswerEvaluation: null,
    parseStatus: "fallback",
    answerWasExpandedFromOption: false
  };

  try {
    const parsed = parseJSONResponse(content);
    const legacyAnswer = cleanField(parsed.answer);
    const answerLabel = normalizeAnswerLabel(
      parsed.answerLabel,
      legacyAnswer,
      ocrText
    );
    const rawAnswerText =
      cleanField(parsed.answerText) || extractLegacyAnswerText(legacyAnswer);
    const resolvedAnswer = resolveAnswerText(
      rawAnswerText,
      answerLabel,
      ocrText
    );
    const answerText = resolvedAnswer.text || "Unknown";

    return {
      mode:
        parsed.mode === "quick" || requestedMode === "quick"
          ? "quick"
          : "learning",
      answerText,
      answerLabel,
      confidence: normalizeConfidence(parsed.confidence),
      shortExplanation: cleanField(parsed.shortExplanation),
      coreKnowledge: cleanField(parsed.coreKnowledge),
      notes: cleanField(parsed.notes),
      optionAnalysis: normalizeOptionAnalysis(
        parsed.optionAnalysis,
        ocrText
      ),
      miniExample: normalizeMiniExample(parsed.miniExample),
      userAnswerEvaluation: normalizeUserAnswerEvaluation(
        parsed.userAnswerEvaluation,
        userSelectedAnswer,
        ocrText
      ),
      parseStatus: "parsed",
      answerWasExpandedFromOption: resolvedAnswer.expandedFromOption
    };
  } catch {
    const recovered = recoverPartialAIResult(content);
    if (!recovered) {
      return fallback;
    }

    const result = parseAIResult(
      JSON.stringify(recovered),
      ocrText,
      { requestedMode, userSelectedAnswer }
    );
    return {
      ...result,
      parseStatus: "recovered",
      confidence:
        result.confidence === "high" ? "medium" : result.confidence,
      notes: [
        result.notes,
        "QuizBuddy recovered the main fields from malformed local AI JSON."
      ]
        .filter(Boolean)
        .join(" ")
    };
  }
}

export function extractVisibleOptions(ocrText) {
  const lines = normalizeOCRChoiceMarkers(String(ocrText || ""))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const labeledOptions = [];

  for (const line of lines) {
    const match = line.match(/^([A-Z]|\d{1,2})\s*[.):\-]\s*(.+)$/i);
    if (match) {
      labeledOptions.push({
        label: match[1].toUpperCase(),
        text: cleanField(match[2])
      });
      continue;
    }

    const previousOption = labeledOptions.at(-1);
    if (previousOption) {
      previousOption.text = `${previousOption.text} ${line}`.trim();
    }
  }

  const alphabeticOptions = labeledOptions.filter((option) =>
    /^[A-Z]$/.test(option.label)
  );
  if (alphabeticOptions.length >= 2) {
    return alphabeticOptions;
  }

  if (labeledOptions.length >= 2) {
    return labeledOptions;
  }

  return [];
}

function parseJSONResponse(content) {
  const json = extractJSONObject(content);
  try {
    return JSON.parse(json);
  } catch (initialError) {
    const repaired = repairCommonJSONErrors(json);
    if (repaired === json) {
      throw initialError;
    }
    return JSON.parse(repaired);
  }
}

function repairCommonJSONErrors(json) {
  return String(json || "")
    .replace(/^\uFEFF/, "")
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/([{,]\s*)([A-Za-z][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
}

function recoverPartialAIResult(content) {
  const source = String(content || "");
  const answerText =
    extractJSONStringField(source, "answerText") ||
    extractJSONStringField(source, "answer");
  const answerLabel = extractJSONStringField(source, "answerLabel");
  const confidence = extractJSONStringField(source, "confidence");
  const shortExplanation = extractJSONStringField(
    source,
    "shortExplanation"
  );
  const coreKnowledge = extractJSONStringField(source, "coreKnowledge");
  const notes = extractJSONStringField(source, "notes");

  if (!answerText && !shortExplanation && !coreKnowledge) {
    return null;
  }

  return {
    answerText,
    answerLabel,
    confidence: confidence || "low",
    shortExplanation,
    coreKnowledge,
    notes,
    optionAnalysis: []
  };
}

function extractJSONStringField(source, fieldName) {
  const keyIndex = source.search(
    new RegExp(`["']?${escapeRegExp(fieldName)}["']?\\s*:`)
  );
  if (keyIndex < 0) {
    return "";
  }

  const colonIndex = source.indexOf(":", keyIndex);
  const remainder = source.slice(colonIndex + 1).trimStart();
  const quote = remainder[0];
  if (quote !== '"' && quote !== "'") {
    const primitive = remainder.match(/^([^,}\n]+)/)?.[1];
    return cleanField(primitive);
  }

  let value = "";
  let escaped = false;
  for (let index = 1; index < remainder.length; index += 1) {
    const character = remainder[index];
    if (escaped) {
      value += decodeJSONEscape(character);
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === quote) {
      return cleanField(value);
    }
    value += character;
  }

  return cleanField(value);
}

function decodeJSONEscape(character) {
  return {
    n: "\n",
    r: "\r",
    t: "\t",
    b: "\b",
    f: "\f"
  }[character] || character;
}

function normalizeOptionAnalysis(value, ocrText) {
  if (!Array.isArray(value)) {
    return [];
  }

  const visibleOptions = extractVisibleOptions(ocrText);
  if (visibleOptions.length < 2) {
    return normalizeUnlabeledOptionAnalysis(value, ocrText);
  }

  return visibleOptions.map((visibleOption) => {
    const modelOption = value.find((option) => {
      const label = cleanField(option?.label).toUpperCase();
      const text = cleanField(option?.text);
      return (
        label === visibleOption.label ||
        normalizeForComparison(text) ===
          normalizeForComparison(visibleOption.text)
      );
    });

    return {
      label: visibleOption.label,
      text: visibleOption.text,
      isCorrect: modelOption?.isCorrect === true,
      reason: cleanField(modelOption?.reason)
    };
  });
}

function normalizeUnlabeledOptionAnalysis(value, ocrText) {
  const normalizedOCR = normalizeForComparison(ocrText);
  const options = value
    .map((option) => ({
      label: "",
      text: cleanField(option?.text),
      isCorrect: option?.isCorrect === true,
      reason: cleanField(option?.reason)
    }))
    .filter(
      (option) =>
        option.text.length >= 2 &&
        normalizedOCR.includes(normalizeForComparison(option.text))
    );

  return options.length >= 2 ? options : [];
}

function normalizeMiniExample(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const question = cleanField(value.question);
  const answer = cleanField(value.answer);
  if (!question || !answer) {
    return null;
  }

  return {
    question,
    answer,
    explanation: cleanField(value.explanation)
  };
}

function normalizeUserAnswerEvaluation(value, userSelectedAnswer, ocrText) {
  const providedAnswer = cleanField(userSelectedAnswer);
  if (!providedAnswer || !value || typeof value !== "object") {
    return null;
  }

  const visibleOptions = extractVisibleOptions(ocrText);
  const providedLabel = providedAnswer.match(/^[A-Z0-9]{1,3}$/i)?.[0];
  const labelIsMissing =
    providedLabel &&
    visibleOptions.length >= 2 &&
    !visibleOptions.some(
      (option) => option.label === providedLabel.toUpperCase()
    );

  return {
    userAnswer: cleanField(value.userAnswer) || providedAnswer,
    isCorrect: labelIsMissing ? false : value.isCorrect === true,
    feedback: labelIsMissing
      ? `The answer label ${providedLabel.toUpperCase()} was not visible in the OCR options. ${cleanField(value.feedback)}`.trim()
      : cleanField(value.feedback),
    mistakePattern: cleanField(value.mistakePattern),
    howToAvoidNextTime: cleanField(value.howToAvoidNextTime)
  };
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
    return {
      text: extractChoiceText(ocrText, label),
      expandedFromOption: true
    };
  }

  return {
    text: answerText,
    expandedFromOption: false
  };
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

function extractJSONObject(content) {
  const source = String(content || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const firstBrace = source.indexOf("{");
  const lastBrace = source.lastIndexOf("}");
  return firstBrace >= 0 && lastBrace > firstBrace
    ? source.slice(firstBrace, lastBrace + 1)
    : source;
}

function normalizeForComparison(value) {
  return cleanField(value)
    .toLocaleLowerCase()
    .replace(/[.,;:!?()[\]{}"'`]/g, "")
    .replace(/\s+/g, " ");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeConfidence(value) {
  const confidence = cleanField(value).toLowerCase();
  return ["low", "medium", "high"].includes(confidence)
    ? confidence
    : "low";
}

function cleanField(value) {
  return String(value || "").trim();
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
