const VALID_LEVELS = new Set(["low", "medium", "high"]);

export function calculateOverallReliability({
  ocrConfidence,
  aiConfidence,
  parseStatus,
  answerWasExpandedFromOption,
  wasOcrEdited
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

  reasons.push(`Local AI confidence is ${normalizedAIConfidence}.`);

  if (wasOcrEdited) {
    reasons.push("The OCR text was manually edited before analysis.");
  }

  if (answerWasExpandedFromOption) {
    reasons.push(
      "The model returned only a label, so QuizBuddy matched it with the OCR option text."
    );
  }

  if (parseStatus !== "parsed") {
    reasons.push("The local AI response could not be parsed reliably.");
    level = "low";
  } else if (hasOCRConfidence && ocrConfidence < 70) {
    reasons.push("Low OCR confidence can change the meaning of the question.");
    level = "low";
  } else if (normalizedAIConfidence === "low") {
    reasons.push("The local model reported low confidence.");
    level = "low";
  } else if (
    normalizedAIConfidence === "high" &&
    ((hasOCRConfidence && ocrConfidence >= 85) || wasOcrEdited) &&
    !answerWasExpandedFromOption
  ) {
    level = "high";
  }

  return { level, reasons };
}
