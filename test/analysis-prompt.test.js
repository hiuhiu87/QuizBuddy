import test from "node:test";
import assert from "node:assert/strict";
import { buildAnalysisPrompt } from "../lib/analysis-prompt.js";

test("analysis prompt requires independent solving and option comparison", () => {
  const prompt = buildAnalysisPrompt(
    "Which statement is NOT correct?\nA. First\nB. Second"
  );

  assert.match(prompt, /Solve the question independently/);
  assert.match(prompt, /compare the solution against each one/);
  assert.match(prompt, /NOT, EXCEPT/);
  assert.match(prompt, /Return Unknown only when the question itself lacks essential information/);
});

test("analysis prompt supports question-only direct answers", () => {
  const prompt = buildAnalysisPrompt(
    "Thủ đô của Việt Nam là thành phố nào?"
  );

  assert.match(prompt, /"direct-answer"/);
  assert.match(prompt, /Do not require or request answer choices/);
  assert.match(prompt, /Missing answer choices alone is not a reason/);
  assert.match(prompt, /empty "answerLabel"/);
});

test("analysis prompt preserves the complete OCR input", () => {
  const ocrText = "Câu hỏi tiếng Việt\nĐáp án không có nhãn";

  assert.match(buildAnalysisPrompt(ocrText), new RegExp(ocrText));
});

test("analysis prompt includes OCR quality context", () => {
  assert.match(
    buildAnalysisPrompt("Question", { ocrConfidence: 64 }),
    /OCR confidence estimate: 64%/
  );
  assert.match(
    buildAnalysisPrompt("Corrected question", { userCorrected: true }),
    /reviewed or corrected/
  );
});
