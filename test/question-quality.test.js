import test from "node:test";
import assert from "node:assert/strict";
import { detectQuestionQuality } from "../lib/question-quality.js";

test("detects missing choices in English, Vietnamese, and German", () => {
  for (const text of [
    "Which of the following statements is correct?",
    "Chọn đáp án nào đúng trong câu hỏi sau?",
    "Welche Aussage ist richtig?"
  ]) {
    const result = detectQuestionQuality({ text, ocrConfidence: 90 });
    assert.equal(result.flags.likelyMissingChoices, true);
    assert.equal(result.status, "warning");
  }
});

test("detects missing passage and visual references", () => {
  const result = detectQuestionQuality({
    text: "According to the passage, what does the graph show?",
    ocrConfidence: 90
  });
  assert.equal(result.flags.likelyMissingPassage, true);
  assert.equal(result.flags.likelyNeedsDiagram, true);
});

test("low OCR confidence and very short text can produce bad quality", () => {
  const result = detectQuestionQuality({
    text: "What?",
    ocrConfidence: 42
  });
  assert.equal(result.status, "bad");
  assert.equal(result.flags.lowOcrConfidence, true);
  assert.equal(result.flags.tooShort, true);
});

test("negation is a warning while a complete normal question is good", () => {
  const warning = detectQuestionQuality({
    text: "Which option is NOT correct?\nA. One\nB. Two\nC. Three",
    ocrConfidence: 92
  });
  assert.equal(warning.flags.negationSensitive, true);
  assert.equal(warning.status, "warning");

  const good = detectQuestionQuality({
    text: "What is the capital city of Vietnam?",
    ocrConfidence: 92
  });
  assert.equal(good.status, "good");
});
