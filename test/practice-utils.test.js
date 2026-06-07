import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPracticePrompt,
  evaluatePracticeAnswer,
  parsePracticeResult
} from "../lib/practice-utils.js";

test("practice prompt reuses concept without copying instructions", () => {
  const prompt = buildPracticePrompt({
    ocrText: "2 + 2 = ?",
    aiResult: { coreKnowledge: "Addition" },
    subject: "math"
  });

  assert.match(prompt, /Addition/);
  assert.match(prompt, /different numbers/);
  assert.match(prompt, /Subject preset: math/);
});

test("practice prompt rejects a missing core concept", () => {
  assert.throws(
    () => buildPracticePrompt({ ocrText: "Question", aiResult: {} }),
    /core concept/
  );
});

test("practice parser and local reveal evaluation are safe", () => {
  const result = parsePracticeResult(
    JSON.stringify({
      practiceQuestion: {
        question: "3 + 3 = ?",
        options: [
          { label: "A", text: "5" },
          { label: "B", text: "6" }
        ],
        answerText: "6",
        answerLabel: "B",
        explanation: "Addition"
      }
    })
  );

  assert.equal(result.ok, true);
  assert.equal(
    evaluatePracticeAnswer(result.practiceQuestion, "B").isCorrect,
    true
  );
  assert.equal(
    evaluatePracticeAnswer(result.practiceQuestion, "A").isCorrect,
    false
  );
});
