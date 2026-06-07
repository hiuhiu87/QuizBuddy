import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateCropPixels,
  extractVisibleOptions,
  normalizeOCRText,
  parseAIResult
} from "../lib/processing-utils.js";

test("calculateCropPixels uses actual screenshot-to-viewport scale", () => {
  assert.deepEqual(
    calculateCropPixels(
      {
        x: 100,
        y: 50,
        width: 300,
        height: 150,
        viewportWidth: 1000,
        viewportHeight: 500,
        devicePixelRatio: 1
      },
      2000,
      1000
    ),
    { sx: 200, sy: 100, sw: 600, sh: 300 }
  );
});

test("calculateCropPixels clamps a selection to image bounds", () => {
  assert.deepEqual(
    calculateCropPixels(
      {
        x: 900,
        y: 450,
        width: 200,
        height: 100,
        viewportWidth: 1000,
        viewportHeight: 500
      },
      2000,
      1000
    ),
    { sx: 1800, sy: 900, sw: 200, sh: 100 }
  );
});

test("normalizeOCRText removes OCR spacing noise", () => {
  assert.equal(
    normalizeOCRText(" Question?  \r\n  A. One \n\n\n B. Two "),
    "Question?\nA. One\nB. Two"
  );
});

test("normalizeOCRText preserves Vietnamese accents in NFC form", () => {
  assert.equal(
    normalizeOCRText("Thu\u031Bo\u031Bng ma\u0323i điẹ\u0302n tu\u031B\u0309"),
    "Thương mại điện tử"
  );
});

test("normalizeOCRText repairs OCR radio markers and inline options", () => {
  const ocrText =
    "Câu hỏi? O A. Một OB. Hai\nO C.Ba O D.Bốn";
  const normalized = normalizeOCRText(ocrText);

  assert.equal(
    normalized,
    "Câu hỏi?\nA. Một\nB. Hai\nC. Ba\nD. Bốn"
  );
  assert.deepEqual(extractVisibleOptions(normalized), [
    { label: "A", text: "Một" },
    { label: "B", text: "Hai" },
    { label: "C", text: "Ba" },
    { label: "D", text: "Bốn" }
  ]);
});

test("normalizeOCRText recognizes the reported Vietnamese OCR sample", () => {
  const ocrText =
    "1. Điều gì xảy ra khi một tiến trình chuyền từ trạng thái Running sang Waiting?\nO A. Tiến trình đã hoàn thành thực thi. OB. Tiến trình đang chờ một sự kiện xảy ra.\nO C.Tiến trình được chuyển sang hàng đợi. O D.Tiến trình bị tạm dừng.";

  assert.deepEqual(extractVisibleOptions(normalizeOCRText(ocrText)), [
    { label: "A", text: "Tiến trình đã hoàn thành thực thi." },
    { label: "B", text: "Tiến trình đang chờ một sự kiện xảy ra." },
    { label: "C", text: "Tiến trình được chuyển sang hàng đợi." },
    { label: "D", text: "Tiến trình bị tạm dừng." }
  ]);
});

test("parseAIResult accepts JSON wrapped in model chatter", () => {
  const result = parseAIResult(
    'Result: {"answerText":"Two","answerLabel":"B","confidence":"HIGH","shortExplanation":"Because.","coreKnowledge":"Rule","notes":"Check units."}',
    "Question?\nA. One\nB. Two"
  );

  assert.equal(result.answerText, "Two");
  assert.equal(result.answerLabel, "B");
  assert.equal(result.confidence, "high");
  assert.equal(result.parseStatus, "parsed");
  assert.deepEqual(result.optionAnalysis, []);
});

test("parseAIResult removes an invented label for unlabeled choices", () => {
  const result = parseAIResult(
    '{"answerText":"Paris","answerLabel":"B","confidence":"high","shortExplanation":"It is the capital.","coreKnowledge":"Geography","notes":""}',
    "Capital of France?\nLondon\nParis\nRome"
  );

  assert.equal(result.answerText, "Paris");
  assert.equal(result.answerLabel, "");
});

test("parseAIResult preserves a full unlabeled answer", () => {
  const result = parseAIResult(
    '{"answerText":"The mitochondrion","answerLabel":"","confidence":"medium","shortExplanation":"It produces ATP.","coreKnowledge":"Cell biology","notes":""}',
    "Which organelle produces ATP?\nNucleus\nThe mitochondrion\nRibosome"
  );

  assert.equal(result.answerText, "The mitochondrion");
  assert.equal(result.answerLabel, "");
});

test("parseAIResult preserves a direct answer without choices", () => {
  const result = parseAIResult(
    '{"answerText":"Hà Nội","answerLabel":"","confidence":"high","shortExplanation":"Hà Nội là thủ đô của Việt Nam.","coreKnowledge":"Địa lý Việt Nam","notes":""}',
    "Thủ đô của Việt Nam là thành phố nào?"
  );

  assert.equal(result.answerText, "Hà Nội");
  assert.equal(result.answerLabel, "");
});

test("parseAIResult expands a label-only answer using OCR choice text", () => {
  const result = parseAIResult(
    '{"answerText":"B","answerLabel":"B","confidence":"high","shortExplanation":"","coreKnowledge":"","notes":""}',
    "Which value is even?\nA. Three\nB. Four\nC. Five"
  );

  assert.equal(result.answerText, "Four");
  assert.equal(result.answerLabel, "B");
  assert.equal(result.answerWasExpandedFromOption, true);
});

test("parseAIResult returns a safe fallback for malformed output", () => {
  const result = parseAIResult("not json");
  assert.equal(result.answerText, "Unknown");
  assert.equal(result.parseStatus, "fallback");
});

test("parseAIResult repairs trailing commas and unquoted keys", () => {
  const result = parseAIResult(
    '{answerText:"Waiting for I/O",confidence:"high",shortExplanation:"Correct",}',
    "Question"
  );

  assert.equal(result.answerText, "Waiting for I/O");
  assert.equal(result.parseStatus, "parsed");
});

test("parseAIResult recovers essential fields from truncated JSON", () => {
  const result = parseAIResult(
    '{"answerText":"Tiến trình đang chờ một sự kiện","answerLabel":"B","confidence":"high","shortExplanation":"Đây là chuyển trạng thái sang Waiting.","coreKnowledge":"Trạng thái tiến trình","notes":"Phân biệt Waiting và Ready","optionAnalysis":[',
    "Câu hỏi?\nA. Hoàn thành\nB. Tiến trình đang chờ một sự kiện"
  );

  assert.equal(result.answerText, "Tiến trình đang chờ một sự kiện");
  assert.equal(result.answerLabel, "B");
  assert.equal(result.parseStatus, "recovered");
  assert.equal(result.confidence, "medium");
});

test("parseAIResult normalizes visible option analysis", () => {
  const result = parseAIResult(
    JSON.stringify({
      answerText: "Two",
      answerLabel: "B",
      confidence: "high",
      optionAnalysis: [
        { label: "A", text: "One", isCorrect: false, reason: "Odd" },
        { label: "B", text: "Two", isCorrect: true, reason: "Even" }
      ]
    }),
    "Which is even?\nA. One\nB. Two"
  );

  assert.deepEqual(result.optionAnalysis, [
    { label: "A", text: "One", isCorrect: false, reason: "Odd" },
    { label: "B", text: "Two", isCorrect: true, reason: "Even" }
  ]);
});

test("parseAIResult filters invented labels but preserves unlabeled options", () => {
  const result = parseAIResult(
    JSON.stringify({
      answerText: "Paris",
      confidence: "high",
      optionAnalysis: [
        { label: "A", text: "London", isCorrect: false, reason: "No" },
        { label: "B", text: "Paris", isCorrect: true, reason: "Yes" }
      ]
    }),
    "Capital of France?\nLondon\nParis\nRome"
  );

  assert.deepEqual(result.optionAnalysis, [
    { label: "", text: "London", isCorrect: false, reason: "No" },
    { label: "", text: "Paris", isCorrect: true, reason: "Yes" }
  ]);
});

test("parseAIResult keeps direct answers free of invented options", () => {
  const result = parseAIResult(
    JSON.stringify({
      answerText: "Hà Nội",
      confidence: "high",
      optionAnalysis: [
        { label: "A", text: "Huế", isCorrect: false, reason: "" }
      ]
    }),
    "Thủ đô của Việt Nam là thành phố nào?"
  );

  assert.deepEqual(result.optionAnalysis, []);
});

test("parseAIResult handles optional learning and answer-check blocks", () => {
  const withoutOptional = parseAIResult(
    '{"answerText":"4","confidence":"high"}',
    "2 + 2 = ?"
  );
  assert.equal(withoutOptional.miniExample, null);
  assert.equal(withoutOptional.userAnswerEvaluation, null);

  const withEvaluation = parseAIResult(
    JSON.stringify({
      answerText: "4",
      confidence: "high",
      miniExample: {
        question: "3 + 3?",
        answer: "6",
        explanation: "Addition"
      },
      userAnswerEvaluation: {
        userAnswer: "5",
        isCorrect: false,
        feedback: "Not quite",
        mistakePattern: "Arithmetic",
        howToAvoidNextTime: "Recalculate"
      }
    }),
    "2 + 2 = ?",
    { userSelectedAnswer: "5" }
  );

  assert.equal(withEvaluation.miniExample.answer, "6");
  assert.equal(withEvaluation.userAnswerEvaluation.isCorrect, false);
});

test("parseAIResult supports correct and free-text user answers", () => {
  const result = parseAIResult(
    JSON.stringify({
      answerText: "Hà Nội",
      confidence: "high",
      userAnswerEvaluation: {
        userAnswer: "Hà Nội",
        isCorrect: true,
        feedback: "Đúng",
        howToAvoidNextTime: ""
      }
    }),
    "Thủ đô Việt Nam?",
    { userSelectedAnswer: "Hà Nội" }
  );

  assert.equal(result.userAnswerEvaluation.userAnswer, "Hà Nội");
  assert.equal(result.userAnswerEvaluation.isCorrect, true);
});

test("parseAIResult safely rejects a user label missing from OCR options", () => {
  const result = parseAIResult(
    JSON.stringify({
      answerText: "One",
      confidence: "high",
      userAnswerEvaluation: {
        userAnswer: "D",
        isCorrect: true,
        feedback: "Looks correct"
      }
    }),
    "Choose one\nA. One\nB. Two",
    { userSelectedAnswer: "D" }
  );

  assert.equal(result.userAnswerEvaluation.isCorrect, false);
  assert.match(result.userAnswerEvaluation.feedback, /not visible/);
});
