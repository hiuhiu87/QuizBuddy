export function buildPracticePrompt({
  ocrText,
  aiResult,
  subject = "auto"
}) {
  const coreKnowledge = String(aiResult?.coreKnowledge || "").trim();
  if (!coreKnowledge) {
    throw new Error(
      "A clear core concept is required before generating a practice question."
    );
  }

  return `Create one short, original practice question that tests the same core concept.

Original question:
"""
${ocrText}
"""

Core concept:
"""
${coreKnowledge}
"""

Subject preset: ${subject}

Rules:
- Use the same language as the original question.
- Do not copy the original wording.
- For math, use different numbers.
- For grammar, use a different sentence.
- Include 2 to 4 options only when that format fits the concept.
- Keep the explanation brief and learning-oriented.
- Return valid JSON only.

JSON structure:
{
  "practiceQuestion": {
    "question": "...",
    "options": [
      { "label": "A", "text": "..." }
    ],
    "answerText": "...",
    "answerLabel": "",
    "explanation": "..."
  }
}`;
}

export function parsePracticeResult(content) {
  const fallback = {
    ok: false,
    error: "Could not parse the local practice question."
  };

  try {
    const parsed = JSON.parse(extractJSONObject(content));
    const practiceQuestion = parsed.practiceQuestion || {};
    const question = cleanField(practiceQuestion.question);
    const answerText = cleanField(practiceQuestion.answerText);
    const options = Array.isArray(practiceQuestion.options)
      ? practiceQuestion.options
          .map((option) => ({
            label: cleanField(option?.label).toUpperCase(),
            text: cleanField(option?.text)
          }))
          .filter((option) => option.text)
          .slice(0, 4)
      : [];

    if (!question || !answerText) {
      return fallback;
    }

    const answerLabel = cleanField(practiceQuestion.answerLabel).toUpperCase();
    return {
      ok: true,
      practiceQuestion: {
        question,
        options,
        answerText,
        answerLabel: options.some(
          (option) => option.label === answerLabel
        )
          ? answerLabel
          : "",
        explanation: cleanField(practiceQuestion.explanation)
      }
    };
  } catch {
    return fallback;
  }
}

export function evaluatePracticeAnswer(practiceQuestion, selectedAnswer) {
  const selected = cleanField(selectedAnswer);
  const expectedLabel = cleanField(
    practiceQuestion?.answerLabel
  ).toUpperCase();
  const expectedText = cleanField(practiceQuestion?.answerText);
  const selectedOption = practiceQuestion?.options?.find(
    (option) => option.label === selected.toUpperCase()
  );
  const selectedText = selectedOption?.text || selected;
  const isCorrect =
    (expectedLabel && selected.toUpperCase() === expectedLabel) ||
    normalizeForComparison(selectedText) ===
      normalizeForComparison(expectedText);

  return {
    isCorrect: Boolean(isCorrect),
    selectedText,
    expectedText
  };
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

function cleanField(value) {
  return String(value || "").trim();
}
