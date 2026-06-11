const VALID_LEVELS = new Set(["low", "medium", "high"]);

export function calculateOverallReliability({
  ocrConfidence,
  aiConfidence,
  parseStatus,
  answerWasExpandedFromOption,
  answerCountMismatch = false,
  requiredAnswerCount = null,
  wasOcrEdited,
  questionQuality = null,
  analyzeAnyway = false,
  formulas = []
}) {
  const reasons = [];
  const normalizedAIConfidence = VALID_LEVELS.has(aiConfidence)
    ? aiConfidence
    : "low";
  const hasOCRConfidence = Number.isFinite(ocrConfidence);
  let level = "medium";

  if (hasOCRConfidence) {
    const roundedOCRConfidence = Math.round(ocrConfidence);
    reasons.push(`OCR confidence is ${roundedOCRConfidence}%.`);
  } else if (wasOcrEdited) {
    reasons.push("OCR confidence is not reused after manual editing.");
  } else {
    reasons.push("OCR confidence is unavailable.");
  }

  if (formulas && formulas.length > 0) {
    const minFormulaConf = Math.min(...formulas.map(f => f.confidence));
    reasons.push(`Math OCR formula confidence is ${Math.round(minFormulaConf)}%.`);
  }

  reasons.push(`Local AI confidence is ${normalizedAIConfidence}.`);

  if (wasOcrEdited) {
    reasons.push("The OCR text was manually edited before analysis.");
  }

  if (answerWasExpandedFromOption) {
    reasons.push(
      "The model returned only a label, so QuizBuddy matched it with the OCR option text."
    );
  }

  if (answerCountMismatch) {
    reasons.push(
      `The question requires ${requiredAnswerCount} answers, but the local model did not return that exact count.`
    );
    level = "low";
  }

  const hasLowFormulaConfidence = formulas && formulas.length > 0 && Math.min(...formulas.map(f => f.confidence)) < 70;
  const hasHighFormulaConfidence = !formulas || formulas.length === 0 || Math.min(...formulas.map(f => f.confidence)) >= 85;

  if (parseStatus !== "parsed") {
    reasons.push("The local AI response could not be parsed reliably.");
    level = "low";
  } else if (hasOCRConfidence && ocrConfidence < 70) {
    reasons.push("Low OCR confidence can change the meaning of the question.");
    level = "low";
  } else if (hasLowFormulaConfidence) {
    reasons.push("Low math formula OCR confidence can introduce formula errors.");
    level = "low";
  } else if (normalizedAIConfidence === "low") {
    reasons.push("The local model reported low confidence.");
    level = "low";
  } else if (
    normalizedAIConfidence === "high" &&
    ((hasOCRConfidence && ocrConfidence >= 85) || wasOcrEdited) &&
    hasHighFormulaConfidence &&
    !answerWasExpandedFromOption &&
    !answerCountMismatch
  ) {
    level = "high";
  }

  if (questionQuality?.status === "warning") {
    reasons.push("Question completeness checks found a warning.");
    if (level === "high") {
      level = "medium";
    }
  }

  if (questionQuality?.status === "bad" || analyzeAnyway) {
    reasons.push(
      analyzeAnyway
        ? "Analysis continued despite a serious question-quality warning."
        : "Question completeness checks found a serious warning."
    );
    level = "low";
  }

  return { level, reasons };
}
