import {
  normalizeSourceTrace,
  numberOcrLines
} from "./source-trace.js";
import {
  detectRequiredAnswerCount,
  getQuestionScopeText,
  inferQuestionLineScopes,
  normalizeQuestionLineRefs
} from "./question-batch.js";

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
    /(^|[ \t\n]+)(?:[O0○◯●]\s*)?([A-H])\s*[.)]\s*/gi,
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
  const fallbackQuestion = {
    questionNumber: 1,
    questionText: "",
    questionLineRefs: [],
    mode: requestedMode === "quick" ? "quick" : "learning",
    answerText: "Unknown",
    answerLabel: "",
    answerSelections: [],
    requiredAnswerCount: null,
    isMultiSelect: false,
    answerCountMismatch: false,
    confidence: "low",
    shortExplanation: "Could not parse the local AI response.",
    coreKnowledge: "",
    notes: "Please try cropping the question more clearly.",
    optionAnalysis: [],
    miniExample: null,
    userAnswerEvaluation: null,
    sourceTrace: [],
    parseStatus: "fallback",
    answerWasExpandedFromOption: false
  };
  const fallback = {
    ...fallbackQuestion,
    questions: [fallbackQuestion],
    questionCount: 1,
    isBatch: false
  };

  try {
    const parsed = parseJSONResponse(content);
    const numberedOCR = numberOcrLines(ocrText);
    const inferredLineScopes = inferQuestionLineScopes(ocrText);
    const parsedQuestions =
      Array.isArray(parsed.questions) && parsed.questions.length
        ? parsed.questions
        : [parsed];
    const questions = parsedQuestions
      .slice(0, 10)
      .map((question, index) =>
        normalizeParsedQuestion(question, {
          index,
          ocrText,
          numberedOCR,
          inferredLineScopes,
          requestedMode,
          userSelectedAnswer: index === 0 ? userSelectedAnswer : ""
        })
      );
    const primary = questions[0] || fallbackQuestion;
    return {
      ...primary,
      questions,
      questionCount: questions.length,
      isBatch: questions.length > 1,
      parseStatus: "parsed",
      mode:
        parsed.mode === "quick" || requestedMode === "quick"
          ? "quick"
          : "learning"
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
      questions: result.questions.map((question) => ({
        ...question,
        parseStatus: "recovered",
        confidence:
          question.confidence === "high" ? "medium" : question.confidence
      })),
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

function normalizeParsedQuestion(
  parsed,
  {
    index,
    ocrText,
    numberedOCR,
    inferredLineScopes,
    requestedMode,
    userSelectedAnswer
  }
) {
  const lineCount = numberedOCR.lines.length;
  const providedLineRefs = normalizeQuestionLineRefs(
    parsed?.questionLineRefs,
    lineCount
  );
  const questionLineRefs =
    providedLineRefs.length > 0
      ? providedLineRefs
      : inferredLineScopes[index] || [];
  const questionText = cleanField(parsed?.questionText);
  const scopedOCRText =
    getQuestionScopeText(
      numberedOCR.lines,
      questionLineRefs,
      questionText
    ) || ocrText;
  const legacyAnswer = cleanField(parsed?.answer);
  const optionAnalysis = normalizeOptionAnalysis(
    parsed?.optionAnalysis,
    scopedOCRText
  );
  const requiredAnswerCount = detectRequiredAnswerCount(scopedOCRText);
  const normalizedAnswers = normalizeAnswerSelections(
    parsed,
    legacyAnswer,
    scopedOCRText,
    optionAnalysis
  );
  const answerSelections = normalizedAnswers.selections;
  const isMultiSelect =
    requiredAnswerCount > 1 || answerSelections.length > 1;
  const answerCountMismatch =
    requiredAnswerCount !== null &&
    answerSelections.length !== requiredAnswerCount;
  const answerLabel = answerSelections
    .map((selection) => selection.label)
    .filter(Boolean)
    .join(", ");
  const answerText = answerSelections.length
    ? answerSelections.map((selection) => selection.text).join("; ")
    : "Unknown";

  return {
    questionNumber:
      Number.isInteger(Number(parsed?.questionNumber)) &&
      Number(parsed.questionNumber) > 0
        ? Number(parsed.questionNumber)
        : index + 1,
    questionText:
      questionText ||
      getQuestionScopeText(numberedOCR.lines, questionLineRefs, ""),
    questionLineRefs,
    mode: requestedMode === "quick" ? "quick" : "learning",
    answerText,
    answerLabel,
    answerSelections,
    requiredAnswerCount,
    isMultiSelect,
    answerCountMismatch,
    confidence: normalizeConfidence(parsed?.confidence),
    shortExplanation: cleanField(parsed?.shortExplanation),
    coreKnowledge: cleanField(parsed?.coreKnowledge),
    notes: cleanField(parsed?.notes),
    optionAnalysis,
    miniExample: normalizeMiniExample(parsed?.miniExample),
    userAnswerEvaluation: normalizeUserAnswerEvaluation(
      parsed?.userAnswerEvaluation,
      userSelectedAnswer,
      scopedOCRText
    ),
    sourceTrace: normalizeSourceTrace(parsed?.sourceTrace, lineCount),
    parseStatus: "parsed",
    answerWasExpandedFromOption: normalizedAnswers.expandedFromOption
  };
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

function normalizeAnswerSelections(
  parsed,
  legacyAnswer,
  ocrText,
  optionAnalysis
) {
  const visibleOptions = extractVisibleOptions(ocrText);
  
  // 1. Extract the top-level explicit answer from answerLabel / answerText
  const explicitCandidates = [];
  const addExplicit = (candidate) => {
    if (candidate !== null && candidate !== undefined && candidate !== "") {
      explicitCandidates.push(candidate);
    }
  };

  if (Array.isArray(parsed?.answerSelections)) {
    parsed.answerSelections.forEach(addExplicit);
  }
  if (Array.isArray(parsed?.answers)) {
    parsed.answers.forEach(addExplicit);
  }
  if (Array.isArray(parsed?.answerLabels)) {
    parsed.answerLabels.forEach((label, index) =>
      addExplicit({
        label,
        text: Array.isArray(parsed?.answerTexts)
          ? parsed.answerTexts[index]
          : ""
      })
    );
  }

  extractAnswerLabels(parsed?.answerLabel, visibleOptions).forEach(
    addExplicit
  );
  
  const rawAnswerText =
    cleanField(parsed?.answerText) || extractLegacyAnswerText(legacyAnswer);
  extractAnswerLabels(rawAnswerText, visibleOptions).forEach(addExplicit);

  // Normalize explicit candidates to see if we have a single, clear top-level answer
  const explicitSelections = [];
  for (const candidate of explicitCandidates) {
    const normalized = normalizeAnswerSelection(
      candidate,
      visibleOptions,
      ocrText
    );
    if (!normalized?.text) {
      continue;
    }
    const duplicate = explicitSelections.some(
      (selection) =>
        (normalized.label && selection.label === normalized.label) ||
        normalizeForComparison(selection.text) ===
          normalizeForComparison(normalized.text)
    );
    if (!duplicate) {
      explicitSelections.push(normalized);
    }
  }

  // 2. Extract options from optionAnalysis
  const analysisCandidates = [];
  optionAnalysis
    .filter((option) => option.isCorrect)
    .forEach((option) => {
      analysisCandidates.push(option);
    });

  const analysisSelections = [];
  for (const candidate of analysisCandidates) {
    const normalized = normalizeAnswerSelection(
      candidate,
      visibleOptions,
      ocrText
    );
    if (!normalized?.text) {
      continue;
    }
    const duplicate = analysisSelections.some(
      (selection) =>
        (normalized.label && selection.label === normalized.label) ||
        normalizeForComparison(selection.text) ===
          normalizeForComparison(normalized.text)
    );
    if (!duplicate) {
      analysisSelections.push(normalized);
    }
  }

  // 3. Determine if the question is single-select or multi-select
  const requiredAnswerCount = detectRequiredAnswerCount(ocrText);
  const hasMultipleExplicit = explicitSelections.length > 1;
  const isTrueFalse = isTrueFalseOptions(visibleOptions);
  const isMultiSelect =
    requiredAnswerCount > 1 || (hasMultipleExplicit && !isTrueFalse);

  let selections = [];
  let expandedFromOption = false;

  if (!isMultiSelect) {
    // For single-select questions:
    // If the top-level summary specifies a single clear option, prioritize it completely
    // and ignore any contradictions in optionAnalysis.
    if (explicitSelections.length === 1) {
      selections = explicitSelections;
    } else if (explicitSelections.length > 1) {
      // If there are multiple explicit answers, take the first one
      selections = [explicitSelections[0]];
    } else if (analysisSelections.length > 0) {
      // Fall back to optionAnalysis if no top-level explicit answer was found
      selections = [analysisSelections[0]];
    } else {
      // General fallback if everything is empty
      const fallbackLabel = normalizeAnswerLabel(
        parsed?.answerLabel,
        legacyAnswer,
        ocrText
      );
      const normalized = normalizeAnswerSelection(
        { label: fallbackLabel, text: rawAnswerText },
        visibleOptions,
        ocrText
      );
      if (normalized?.text) {
        selections = [normalized];
      }
    }
  } else {
    // For multi-select questions:
    // Merge explicit selections and analysis selections
    const merged = [...explicitSelections];
    for (const selection of analysisSelections) {
      const duplicate = merged.some(
        (item) =>
          (selection.label && item.label === selection.label) ||
          normalizeForComparison(item.text) ===
            normalizeForComparison(selection.text)
      );
      if (!duplicate) {
        merged.push(selection);
      }
    }
    selections = merged;
    
    // If we still have nothing, try the fallback
    if (!selections.length) {
      const fallbackLabel = normalizeAnswerLabel(
        parsed?.answerLabel,
        legacyAnswer,
        ocrText
      );
      const normalized = normalizeAnswerSelection(
        { label: fallbackLabel, text: rawAnswerText },
        visibleOptions,
        ocrText
      );
      if (normalized?.text) {
        selections = [normalized];
      }
    }
  }

  // Set expandedFromOption
  expandedFromOption = selections.some((s) => s.expandedFromOption);
  
  // Return selections stripped of extra properties
  const finalSelections = selections.map((s) => ({
    label: s.label,
    text: s.text
  }));

  return { selections: finalSelections, expandedFromOption };
}

function isTrueFalseOptions(options) {
  if (!options || options.length !== 2) {
    return false;
  }
  const t1 = normalizeForComparison(options[0].text);
  const t2 = normalizeForComparison(options[1].text);

  const trueWords = ["đúng", "dung", "true", "correct", "right", "bung"];
  const falseWords = ["sai", "false", "incorrect", "wrong"];

  return (
    (trueWords.includes(t1) && falseWords.includes(t2)) ||
    (trueWords.includes(t2) && falseWords.includes(t1))
  );
}

function normalizeAnswerSelection(candidate, visibleOptions, ocrText) {
  const candidateObject =
    candidate && typeof candidate === "object"
      ? candidate
      : { label: candidate, text: candidate };
  const rawLabel = cleanField(candidateObject.label).toUpperCase();
  const rawText = cleanField(candidateObject.text);
  if (
    isSchemaPlaceholder(rawText) ||
    isSchemaPlaceholder(candidateObject.label)
  ) {
    return null;
  }
  const label = visibleOptions.some((option) => option.label === rawLabel)
    ? rawLabel
    : "";
  const matchingOption = visibleOptions.find(
    (option) =>
      option.label === label ||
      normalizeForComparison(option.text) === normalizeForComparison(rawText)
  );

  if (matchingOption) {
    const textIsOnlyLabel =
      !rawText ||
      new RegExp(
        `^(?:option\\s+)?${escapeRegExp(matchingOption.label)}$`,
        "i"
      ).test(rawText);
    return {
      label: matchingOption.label,
      text: matchingOption.text,
      expandedFromOption: textIsOnlyLabel
    };
  }

  const normalizedLabel = normalizeAnswerLabel(rawLabel, rawText, ocrText);
  const resolved = resolveAnswerText(rawText, normalizedLabel, ocrText);
  return {
    label: normalizedLabel,
    text: resolved.text,
    expandedFromOption: resolved.expandedFromOption
  };
}

function extractAnswerLabels(value, visibleOptions) {
  const source = cleanField(value).toUpperCase();
  if (!source || visibleOptions.length < 2) {
    return [];
  }
  const visibleLabels = new Set(
    visibleOptions.map((option) => option.label)
  );
  if (visibleLabels.has(source)) {
    return [{ label: source, text: "" }];
  }
  if (
    !/^[A-Z0-9,\s;/&+|-]+$/.test(source) ||
    !/[,\s;/&+|-]/.test(source)
  ) {
    return [];
  }
  const tokens = source
    .split(/[\s,;/&+|-]+/)
    .map((label) => label.trim())
    .filter(Boolean);
  if (
    tokens.length < 2 ||
    !tokens.every((label) => visibleLabels.has(label))
  ) {
    return [];
  }
  return tokens.map((label) => ({ label, text: "" }));
}

function isSchemaPlaceholder(value) {
  const normalized = cleanField(value)
    .toLocaleLowerCase()
    .replace(/\s+/g, " ");
  if (normalized === "...") {
    return true;
  }
  return [
    "selected answer text",
    "actual answer text, never only a letter",
    "actual answer text",
    "actual selected answer content",
    "visible selected label or empty",
    "visible option label or empty string",
    "the complete selected answer text",
    "an exact visible selected option label or empty string",
    "recognizable question text",
    "one concise explanation",
    "one concise concept",
    "one short study note"
  ].some((placeholder) => normalized.includes(placeholder));
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
