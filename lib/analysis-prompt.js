import {
  normalizeAnalysisMode,
  normalizeSubjectPreset
} from "./app-config.js";
import {
  detectQuestionLanguage,
  getResponseLanguageInstruction
} from "./language-utils.js";

export function buildAnalysisPrompt(
  ocrText,
  {
    ocrConfidence = null,
    userCorrected = false,
    mode = "learning",
    subject = "auto",
    userSelectedAnswer = ""
  } = {}
) {
  const normalizedMode = normalizeAnalysisMode(mode);
  const normalizedSubject = normalizeSubjectPreset(subject);
  const targetLanguage = detectQuestionLanguage(ocrText);
  const sourceQuality = userCorrected
    ? "The user reviewed or corrected this text manually."
    : Number.isFinite(ocrConfidence)
      ? `OCR confidence estimate: ${Math.round(ocrConfidence)}%. Treat uncertain or malformed text cautiously.`
      : "OCR confidence is unavailable. Treat malformed text cautiously.";
  const userAnswer = String(userSelectedAnswer || "").trim();
  const modeGuidance =
    normalizedMode === "quick"
      ? `Quick Answer mode:
- Keep the explanation to one or two concise sentences.
- Keep optionAnalysis and miniExample empty.`
      : `Learning Mode:
- Explain why the best answer is correct.
- Explain why each visible option is correct or wrong.
- Include a short core concept, study note, and one compact mini example when useful.`;

  return `The user extracted the following text from an image of a question.

Required response language:
${getResponseLanguageInstruction(targetLanguage)}

Source quality:
${sourceQuality}

Subject guidance:
${getSubjectGuidance(normalizedSubject)}

${modeGuidance}

First classify the input:
- "multiple-choice": two or more answer choices are visible.
- "direct-answer": the question is visible but no answer choices are included.

Accuracy procedure:
1. Identify exactly what the question asks.
2. Solve the question independently using the relevant facts, calculation, or rule.
3. For multiple-choice input, identify every visible choice and compare the solution against each one.
4. For direct-answer input, answer the question directly from knowledge or calculation. Do not require or request answer choices.
5. Return Unknown only when the question itself lacks essential information, is contradictory, or is unreadable. Missing answer choices alone is not a reason to return Unknown.

OCR text:
"""
${ocrText}
"""

User answer to check:
${userAnswer ? JSON.stringify(userAnswer) : "Not provided"}

Return valid JSON only with this structure:
{
  "mode": "${normalizedMode}",
  "answerText": "The complete text or value of the best answer, or Unknown",
  "answerLabel": "The exact option label shown in OCR such as A, B, 1, or empty string",
  "confidence": "low/medium/high",
  "shortExplanation": "Briefly explain why the answer is correct.",
  "coreKnowledge": "The key concept, formula, grammar rule, or theory needed to solve the question.",
  "notes": "A short learning note to help the user avoid common mistakes.",
  "optionAnalysis": [
    {
      "label": "An exact visible label or empty string",
      "text": "Exact visible option text",
      "isCorrect": false,
      "reason": "Why this option is correct or wrong"
    }
  ],
  "miniExample": {
    "question": "A short similar example",
    "answer": "The example answer",
    "explanation": "Why"
  },
  "userAnswerEvaluation": ${
    userAnswer
      ? `{
    "userAnswer": ${JSON.stringify(userAnswer)},
    "isCorrect": false,
    "feedback": "Kind, learning-oriented feedback",
    "mistakePattern": "Likely misconception or empty string",
    "howToAvoidNextTime": "A practical next-step"
  }`
      : "null"
  }
}

Rules:
- Do not include markdown or text outside JSON.
- Perform the accuracy procedure internally before producing JSON.
- A crop containing only the question is valid direct-answer input.
- Never refuse to answer merely because no answer choices are visible.
- Check negations and qualifiers such as NOT, EXCEPT, incorrect, best, most, and least.
- For calculations, verify signs, units, formulas, arithmetic, and substitutions.
- Always put the actual answer content in "answerText", not only a letter.
- Only set "answerLabel" when that exact label is visibly present before an option in the OCR text.
- Never invent option labels or option text.
- If choices are unlabeled, use the full selected choice text and an empty label.
- For direct-answer input, use an empty "answerLabel" and optionAnalysis.
- If the OCR text is unclear or incomplete, use "Unknown" and an empty answerLabel.
- Follow the required response language for every user-facing JSON field.
- If no user answer was provided, return userAnswerEvaluation as null.
- If a user answer was provided, evaluate it kindly without shaming the learner.
- In Quick Answer mode, return an empty optionAnalysis and omit or null miniExample.`;
}

export function getSubjectGuidance(subject) {
  switch (normalizeSubjectPreset(subject)) {
    case "english":
      return "Focus on English grammar, vocabulary, collocation, tense, and connectors.";
    case "german":
      return "Focus on German grammar, cases, articles, word order, vocabulary, and pronunciation when relevant.";
    case "math":
      return "Check calculations carefully. Pay attention to units, signs, formulas, and arithmetic. In Learning Mode, show concise steps.";
    case "general-knowledge":
      return "Explain the concept briefly and state uncertainty when the facts are not clear.";
    case "law":
      return "Explain the legal concept carefully. Avoid overconfident conclusions when jurisdiction or facts are incomplete; legal answers may depend on both.";
    default:
      return "Use general reasoning and select the most relevant concept from the question.";
  }
}

export function buildCompactRetryPrompt(
  ocrText,
  { subject = "auto", forceLanguage = "" } = {}
) {
  const targetLanguage = forceLanguage || detectQuestionLanguage(ocrText);
  return `Analyze this question again and return one small valid JSON object.

Required response language:
${getResponseLanguageInstruction(targetLanguage)}

Subject guidance:
${getSubjectGuidance(subject)}

Question text:
"""
${ocrText}
"""

Return exactly:
{
  "answerText": "actual answer text, never only a letter",
  "answerLabel": "visible option label or empty string",
  "confidence": "low/medium/high",
  "shortExplanation": "one concise explanation",
  "coreKnowledge": "one concise concept",
  "notes": "one short study note"
}

No markdown. No extra fields. No text outside JSON.
If answer options are present, use only labels and option text visible above.
Question-only input is valid and should be answered directly.`;
}
