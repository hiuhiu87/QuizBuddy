export function buildAnalysisPrompt(
  ocrText,
  { ocrConfidence = null, userCorrected = false } = {}
) {
  const sourceQuality = userCorrected
    ? "The user reviewed or corrected this text manually."
    : Number.isFinite(ocrConfidence)
      ? `OCR confidence estimate: ${Math.round(ocrConfidence)}%. Treat uncertain or malformed text cautiously.`
      : "OCR confidence is unavailable. Treat malformed text cautiously.";

  return `The user extracted the following text from an image of a question.

Source quality:
${sourceQuality}

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

Return valid JSON only with this structure:
{
  "answerText": "The complete text or value of the best answer, or Unknown",
  "answerLabel": "The exact option label shown in OCR such as A, B, 1, or empty string",
  "confidence": "low/medium/high",
  "shortExplanation": "Briefly explain why the answer is correct.",
  "coreKnowledge": "The key concept, formula, grammar rule, or theory needed to solve the question.",
  "notes": "A short learning note to help the user avoid common mistakes."
}

Rules:
- Do not include markdown.
- Do not include extra text outside JSON.
- Perform the accuracy procedure internally before producing JSON.
- A crop containing only the question is valid direct-answer input.
- Never refuse to answer merely because no answer choices are visible.
- Do not choose an option merely because it resembles a familiar answer.
- Check negations and qualifiers such as NOT, EXCEPT, incorrect, best, most, and least.
- For calculations, verify signs, units, and substitutions before choosing.
- Always put the actual answer content in "answerText", not only a letter.
- Only set "answerLabel" when that exact label is visibly present before an option in the OCR text.
- Never invent A/B/C/D labels when the choices are unlabeled.
- If choices are unlabeled, return the full selected choice text and use an empty "answerLabel".
- For direct-answer, calculated, or open-response input, return the actual answer in "answerText" and use an empty "answerLabel".
- If the OCR text is unclear or incomplete, use "Unknown" and an empty "answerLabel".
- Write the answer and learning explanation in the same language as the question.
- Focus on learning explanation, not just the final answer.`;
}
