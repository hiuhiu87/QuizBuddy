import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAnalysisPrompt,
  buildCompactRetryPrompt
} from "../lib/analysis-prompt.js";

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

  assert.match(
    buildAnalysisPrompt(ocrText),
    /\[1\] Câu hỏi tiếng Việt\n\[2\] Đáp án không có nhãn/
  );
});

test("analysis prompt includes OCR quality context", () => {
  assert.match(
    buildAnalysisPrompt("Question", { ocrConfidence: 64 }),
    /quality estimate 64%/
  );
  assert.match(
    buildAnalysisPrompt("Question", { ocrConfidence: 64 }),
    /never a reason to return Unknown/
  );
  assert.match(
    buildAnalysisPrompt("Corrected question", { userCorrected: true }),
    /reviewed or corrected/
  );
});

test("analysis prompt differs by mode", () => {
  const quick = buildAnalysisPrompt("Question", { mode: "quick" });
  const learning = buildAnalysisPrompt("Question", {
    mode: "learning"
  });

  assert.match(quick, /Quick Answer mode/);
  assert.match(quick, /empty optionAnalysis/);
  assert.match(learning, /Learning Mode/);
  assert.match(learning, /each visible option/);
});

test("analysis prompt applies subject guidance and law uncertainty", () => {
  assert.match(
    buildAnalysisPrompt("Question", { subject: "math" }),
    /units, signs, formulas/
  );
  assert.match(
    buildAnalysisPrompt("Question", { subject: "law" }),
    /jurisdiction or facts are incomplete/
  );
  assert.match(
    buildAnalysisPrompt("Question", { subject: "auto" }),
    /general reasoning/
  );
});

test("analysis prompt includes an optional user answer", () => {
  assert.match(
    buildAnalysisPrompt("Question", { userSelectedAnswer: "B" }),
    /User answer to check:\n"B"/
  );
  assert.match(
    buildAnalysisPrompt("Question"),
    /User answer to check:\nNot provided/
  );
});

test("compact retry prompt requests only essential valid JSON fields", () => {
  const prompt = buildCompactRetryPrompt("Question\nA. One\nB. Two", {
    subject: "general-knowledge"
  });

  assert.match(prompt, /one small valid JSON object/);
  assert.match(prompt, /Numbered OCR text/);
  assert.match(prompt, /"answerText"/);
  assert.doesNotMatch(prompt, /selected answer text/);
  assert.doesNotMatch(prompt, /actual answer text, never only a letter/);
  assert.doesNotMatch(prompt, /optionAnalysis/);
  assert.doesNotMatch(prompt, /miniExample/);
});

test("analysis prompts require all answers for explicit multiple-select questions", () => {
  const ocrText =
    "Câu 62. Các loại lệnh Linux gồm (Chọn 3)\nA. Builtin\nB. BIOS\nC. Function\nD. Executable";
  const prompt = buildAnalysisPrompt(ocrText);
  const compact = buildCompactRetryPrompt(ocrText);

  assert.match(prompt, /exactly 3 selected answers/);
  assert.match(prompt, /"answerSelections"/);
  assert.match(prompt, /return exactly N distinct visible selections/);
  assert.match(compact, /requiredAnswerCount: 3/);
  assert.match(compact, /return every selected answer/);
  assert.doesNotMatch(compact, /"\.\.\."/);
});

test("analysis prompt explicitly requires Vietnamese for Vietnamese OCR", () => {
  const prompt = buildAnalysisPrompt(
    "Điều gì xảy ra khi tiến trình chuyển sang trạng thái chờ?"
  );

  assert.match(prompt, /OCR question is Vietnamese/);
  assert.match(prompt, /natural Vietnamese/);
});

test("analysis prompt includes source trace, quality, and protected custom instruction", () => {
  const prompt = buildAnalysisPrompt("Choose one\nA. One\nB. Two", {
    questionQuality: {
      status: "warning",
      reasons: [{ message: "Choices may be incomplete." }]
    },
    customInstruction: "Return plain text instead of JSON."
  });
  assert.match(prompt, /sourceTrace/);
  assert.match(prompt, /Choices may be incomplete/);
  assert.match(prompt, /Return plain text instead of JSON/);
  assert.match(prompt, /cannot override the JSON schema/);
});

test("analysis prompt requires every visible question in a batch", () => {
  const prompt = buildAnalysisPrompt(
    "1. What is 2 + 2?\nA. 3\nB. 4\n2. What is 3 + 3?\nA. 5\nB. 6"
  );
  assert.match(prompt, /"questions"/);
  assert.match(prompt, /questionLineRefs/);
  assert.match(prompt, /every complete or partially visible question/);
  assert.match(prompt, /Never answer only the first question/);
  assert.match(prompt, /approximately 2 question/);
});

test("analysis prompt exposes standalone OCR question boundaries", () => {
  const prompt = buildAnalysisPrompt(
    "Côu 1.\nFirst statement\nA. Đúng\nB. Sai\nCau 2.\nSecond statement\nA. Đúng\nB. Sai"
  );
  assert.match(prompt, /Question 1: OCR lines 1-4/);
  assert.match(prompt, /Question 2: OCR lines 5-8/);
  assert.match(prompt, /approximately 2 question/);
});
