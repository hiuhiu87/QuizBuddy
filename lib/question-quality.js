import { extractVisibleOptions } from "./processing-utils.js";

const MULTIPLE_CHOICE_SIGNALS = [
  /which of the following/i,
  /choose the correct/i,
  /select the correct/i,
  /which sentence/i,
  /which statement/i,
  /đáp án nào/iu,
  /chọn đáp án/iu,
  /câu nào (?:đúng|sai)/iu,
  /welche aussage/iu,
  /welche antwort/iu,
  /wählen sie/iu,
  /was ist (?:richtig|falsch)/iu
];
const PASSAGE_SIGNALS = [
  /according to the passage/i,
  /\bin the text\b/i,
  /\bthe author\b/i,
  /\bparagraph\b/i,
  /đoạn văn/iu,
  /bài đọc/iu,
  /theo đoạn văn/iu,
  /tác giả/iu,
  /\bim text\b/iu,
  /laut dem text/iu,
  /der autor/iu
];
const VISUAL_SIGNALS = [
  /see the figure/i,
  /\bdiagram\b/i,
  /\btable\b/i,
  /\bchart\b/i,
  /\bgraph\b/i,
  /\bhình\b/iu,
  /\bbảng\b/iu,
  /biểu đồ/iu,
  /đồ thị/iu,
  /siehe abbildung/iu,
  /\btabelle\b/iu,
  /\bgrafik\b/iu
];
const NEGATION_SIGNALS = [
  /\bnot\b/i,
  /\bexcept\b/i,
  /\bleast\b/i,
  /\bincorrect\b/i,
  /không đúng/iu,
  /ngoại trừ/iu,
  /ít nhất/iu,
  /\bfalsch\b/iu,
  /\bnicht\b/iu,
  /\baußer\b/iu
];

export function detectQuestionQuality({
  text,
  ocrConfidence,
  subject = "auto",
  mode = "learning"
} = {}) {
  const source = String(text || "").normalize("NFC").trim();
  const meaningfulLength = (
    source.match(/[\p{L}\p{N}]/gu) || []
  ).length;
  const hasChoices =
    extractVisibleOptions(source).length >= 2 ||
    countChoiceMarkers(source) >= 2;
  const likelyMissingChoices =
    matchesAny(source, MULTIPLE_CHOICE_SIGNALS) && !hasChoices;
  const likelyMissingPassage =
    matchesAny(source, PASSAGE_SIGNALS) &&
    (meaningfulLength < 180 || source.split(/\n+/).length < 4);
  const likelyNeedsDiagram = matchesAny(source, VISUAL_SIGNALS);
  const negationSensitive = matchesAny(source, NEGATION_SIGNALS);
  const tooShort = meaningfulLength < 20;
  const confidence = Number(ocrConfidence);
  const hasConfidence = Number.isFinite(confidence);
  const lowOcrConfidence = hasConfidence && confidence < 70;
  const reasons = [];
  const suggestions = [];
  let score = 1;
  let status = "good";

  if (hasConfidence && confidence < 50) {
    addReason(reasons, "VERY_LOW_OCR_CONFIDENCE", "OCR confidence is below 50%.");
    suggestions.push("Review or correct the OCR text before analysis.");
    score -= 0.55;
    status = "bad";
  } else if (lowOcrConfidence) {
    addReason(reasons, "LOW_OCR_CONFIDENCE", "OCR confidence is below 70%.");
    suggestions.push("Review the OCR text before analysis.");
    score -= 0.25;
    status = "warning";
  }

  if (tooShort) {
    addReason(reasons, "TEXT_TOO_SHORT", "The recognized question is very short.");
    suggestions.push("Crop the complete question or add the missing text.");
    score -= 0.5;
    status = meaningfulLength < 10 ? "bad" : maxStatus(status, "warning");
  }
  if (likelyMissingChoices) {
    addReason(reasons, "MISSING_CHOICES", "The question appears to reference answer choices that are missing.");
    suggestions.push("Crop the answer choices as well.");
    score -= 0.35;
    status = maxStatus(status, "warning");
  }
  if (likelyMissingPassage) {
    addReason(reasons, "MISSING_PASSAGE", "The question may be missing its passage or surrounding context.");
    suggestions.push("Include the referenced passage or paragraph.");
    score -= 0.3;
    status = maxStatus(status, "warning");
  }
  if (likelyNeedsDiagram) {
    addReason(reasons, "NEEDS_VISUAL", "The question refers to a diagram, table, chart, or image.");
    suggestions.push("Crop the referenced visual together with the question.");
    score -= 0.25;
    status = maxStatus(status, "warning");
  }
  if (negationSensitive) {
    addReason(reasons, "NEGATION_SENSITIVE", "The question contains a negation or exception.");
    suggestions.push("Review negation words carefully before choosing an answer.");
    score -= 0.08;
    status = maxStatus(status, "warning");
  }

  return {
    status,
    score: Math.max(0, Math.min(1, Number(score.toFixed(2)))),
    reasons,
    suggestions: [...new Set(suggestions)],
    flags: {
      hasQuestionMark: /[?？]/u.test(source),
      hasChoices,
      likelyMissingChoices,
      likelyMissingPassage,
      likelyNeedsDiagram,
      negationSensitive,
      tooShort,
      lowOcrConfidence
    },
    subject,
    mode
  };
}

function countChoiceMarkers(text) {
  return (
    String(text).match(
      /(?:^|\n|\s)(?:[A-D]|\d{1,2})\s*[.):\-]|[①②③④]/giu
    ) || []
  ).length;
}

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function addReason(reasons, code, message) {
  reasons.push({ code, message });
}

function maxStatus(current, next) {
  const rank = { good: 0, warning: 1, bad: 2 };
  return rank[next] > rank[current] ? next : current;
}
