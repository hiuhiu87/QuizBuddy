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

test("normalizeOCRText removes degree and checkbox/bullet noise lines and labels", () => {
  const ocrText = `Xác định thành ngữ trong đoạn văn sau: “Lí Thông lân la gợi chuyện, rồi gạ cùng
Thạch Sanh kết nghĩa anh em. Sớm mồ côi cha mẹ, tứ cố vô thân, nay có người
săn sóc đến mình, Thạch Sanh cảm động, vui vẻ nhận lờ! (Thạch Sanh)

°
A. Kết nghĩa anh em.

°
B. Mồ côi cha mẹ.
C. Tứ cố vô thân.
D. Đoạn văn trên không có thành ngữ.`;

  const normalized = normalizeOCRText(ocrText);
  // Ensure the standalone ° is completely gone
  assert.ok(!normalized.includes("°"));

  assert.deepEqual(extractVisibleOptions(normalized), [
    { label: "A", text: "Kết nghĩa anh em." },
    { label: "B", text: "Mồ côi cha mẹ." },
    { label: "C", text: "Tứ cố vô thân." },
    { label: "D", text: "Đoạn văn trên không có thành ngữ." }
  ]);
});

test("normalizeOCRText separates inline answer choices through H", () => {
  const ocrText =
    "Cau 62.\nCac loại lệnh trong Linux gồm:(Chọn 3)\nA. Shell builtin\nB. BIOS command\nC. Shel function\nD. Executable E. Alias F. Hardware command";

  assert.deepEqual(extractVisibleOptions(normalizeOCRText(ocrText)), [
    { label: "A", text: "Shell builtin" },
    { label: "B", text: "BIOS command" },
    { label: "C", text: "Shel function" },
    { label: "D", text: "Executable" },
    { label: "E", text: "Alias" },
    { label: "F", text: "Hardware command" }
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

test("parseAIResult can trust model selections for image-direct input", () => {
  const result = parseAIResult(
    JSON.stringify({
      questions: [
        {
          questionNumber: 1,
          questionText: "Which value is even?",
          questionLineRefs: [],
          answerSelections: [{ label: "B", text: "Four" }],
          requiredAnswerCount: 1,
          answerText: "Four",
          answerLabel: "B",
          confidence: "high",
          shortExplanation: "Four is divisible by 2.",
          coreKnowledge: "Even numbers",
          notes: "",
          optionAnalysis: [
            { label: "A", text: "Three", isCorrect: false, reason: "Odd." },
            { label: "B", text: "Four", isCorrect: true, reason: "Even." }
          ],
          miniExample: null,
          userAnswerEvaluation: null,
          sourceTrace: []
        }
      ]
    }),
    "",
    { trustModelSelections: true }
  );

  assert.deepEqual(result.answerSelections, [{ label: "B", text: "Four" }]);
  assert.equal(result.answerLabel, "B");
  assert.equal(result.answerText, "Four");
  assert.equal(result.optionAnalysis.length, 2);
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

test("parseAIResult preserves every explicit multiple-select answer", () => {
  const ocrText =
    "Cau 62.\nCac loại lệnh trong Linux gồm:(Chọn 3)\nA. Shell builtin\nB. BIOS command\nC. Shel function\nD. Executable E. Alias F. Hardware command";
  const result = parseAIResult(
    JSON.stringify({
      answerSelections: [
        { label: "A", text: "Shell builtin" },
        { label: "C", text: "Shell function" },
        { label: "D", text: "Executable" }
      ],
      answerText: "Shell builtin; Shell function; Executable",
      answerLabel: "A, C, D",
      confidence: "high"
    }),
    ocrText
  );

  assert.deepEqual(result.answerSelections, [
    { label: "A", text: "Shell builtin" },
    { label: "C", text: "Shel function" },
    { label: "D", text: "Executable" }
  ]);
  assert.equal(result.answerLabel, "A, C, D");
  assert.equal(result.requiredAnswerCount, 3);
  assert.equal(result.isMultiSelect, true);
  assert.equal(result.answerCountMismatch, false);
});

test("parseAIResult recovers multiple answers from correct option analysis", () => {
  const ocrText =
    "Chọn 3 đáp án\nA. First\nB. Second\nC. Third\nD. Fourth";
  const result = parseAIResult(
    JSON.stringify({
      answerText: "First",
      answerLabel: "A",
      confidence: "high",
      optionAnalysis: [
        { label: "A", text: "First", isCorrect: true },
        { label: "B", text: "Second", isCorrect: false },
        { label: "C", text: "Third", isCorrect: true },
        { label: "D", text: "Fourth", isCorrect: true }
      ]
    }),
    ocrText
  );

  assert.deepEqual(
    result.answerSelections.map((selection) => selection.label),
    ["A", "C", "D"]
  );
  assert.equal(result.answerCountMismatch, false);
});

test("parseAIResult recovers a multiple-select label list from answerText", () => {
  const result = parseAIResult(
    '{"answerText":"A, C, D","confidence":"high"}',
    "Chọn 3\nA. First\nB. Second\nC. Third\nD. Fourth"
  );

  assert.deepEqual(result.answerSelections, [
    { label: "A", text: "First" },
    { label: "C", text: "Third" },
    { label: "D", text: "Fourth" }
  ]);
  assert.equal(result.answerCountMismatch, false);
});

test("parseAIResult flags an incomplete multiple-select result", () => {
  const result = parseAIResult(
    '{"answerText":"First","answerLabel":"A","confidence":"high"}',
    "Choose 3\nA. First\nB. Second\nC. Third\nD. Fourth"
  );

  assert.equal(result.requiredAnswerCount, 3);
  assert.equal(result.answerSelections.length, 1);
  assert.equal(result.answerCountMismatch, true);
});

test("parseAIResult rejects copied JSON schema placeholders", () => {
  const result = parseAIResult(
    JSON.stringify({
      answerSelections: [
        {
          label: "visible selected label or empty",
          text: "selected answer text"
        }
      ],
      answerText: "actual answer text, never only a letter",
      answerLabel: "visible option label or empty string",
      confidence: "high"
    }),
    "Cau 69.\nCac thao tac thay doi pham vi bien: (Chon 3)\nA. delete VAR\nB. export VAR\nC. export VAR=value\nD. export -n VAR\nE. unset VAR\nF. rm VAR"
  );

  assert.equal(result.answerText, "Unknown");
  assert.deepEqual(result.answerSelections, []);
  assert.equal(result.answerCountMismatch, true);
});

test("parseAIResult returns a safe fallback for malformed output", () => {
  const result = parseAIResult("not json");
  assert.equal(result.answerText, "Unknown");
  assert.equal(result.parseStatus, "fallback");
});

test("parseAIResult rejects JSON arrays and WebLLM invalid JSON sentinels", () => {
  const arrayResult = parseAIResult('["_"]', "Câu 1?\nA. Đúng\nB. Sai");
  const sentinelResult = parseAIResult(
    `_invalid_ JSON: JSON parse error at line 1 column 1 (character 1): Expecting: 'EOF' but found: '{' (invalid JSON)`,
    "Câu 1?\nA. Đúng\nB. Sai"
  );

  assert.equal(arrayResult.answerText, "Unknown");
  assert.equal(arrayResult.parseStatus, "fallback");
  assert.equal(sentinelResult.answerText, "Unknown");
  assert.equal(sentinelResult.parseStatus, "fallback");
});

test("parseAIResult strips Qwen thinking blocks before parsing JSON", () => {
  const result = parseAIResult(
    `<think>
I should reason privately and not expose this.
</think>
{
  "questions": [
    {
      "questionNumber": 1,
      "questionText": "Lệnh help dùng để hiển thị trợ giúp cho các chương trình tích hợp sẵn trong shell.",
      "questionLineRefs": [1, 2, 3],
      "answerSelections": [{ "label": "A", "text": "Đúng" }],
      "requiredAnswerCount": 1,
      "answerText": "A. Đúng",
      "answerLabel": "A",
      "confidence": "high",
      "shortExplanation": "help hiển thị trợ giúp cho shell builtins."
    }
  ]
}`,
    "Câu 1.\nLệnh help dùng để hiển thị trợ giúp cho các chương trình tích hợp sẵn trong shell.\nA. Đúng\nB. Sai"
  );

  assert.equal(result.answerLabel, "A");
  assert.equal(result.answerText, "Đúng");
  assert.equal(result.parseStatus, "parsed");
});

test("parseAIResult safely falls back for unterminated thinking output", () => {
  const result = parseAIResult(
    `<think>
The answer might be A because help handles shell builtins.`,
    "Câu 1.\nLệnh help dùng để hiển thị trợ giúp cho các chương trình tích hợp sẵn trong shell.\nA. Đúng\nB. Sai"
  );

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

test("parseAIResult accepts missing source trace and filters invalid references", () => {
  const legacy = parseAIResult(
    '{"answerText":"Two","confidence":"high"}',
    "Question\nA. One\nB. Two"
  );
  assert.deepEqual(legacy.sourceTrace, []);

  const traced = parseAIResult(
    JSON.stringify({
      answerText: "Two",
      confidence: "high",
      sourceTrace: [
        {
          claim: "B is the answer.",
          lineRefs: [3, 8],
          reason: "Line 3 contains B."
        }
      ]
    }),
    "Question\nA. One\nB. Two"
  );
  assert.deepEqual(traced.sourceTrace[0].lineRefs, [3]);
});

test("parseAIResult returns every batch question and preserves legacy top-level fields", () => {
  const ocrText =
    "1. Which number is even?\nA. Three\nB. Four\n2. Which number is odd?\nA. Six\nB. Seven";
  const result = parseAIResult(
    JSON.stringify({
      mode: "learning",
      questions: [
        {
          questionNumber: 1,
          questionText: "Which number is even?",
          questionLineRefs: [1, 2, 3],
          answerText: "B",
          answerLabel: "B",
          confidence: "high",
          shortExplanation: "Four is even."
        },
        {
          questionNumber: 2,
          questionText: "Which number is odd?",
          questionLineRefs: [4, 5, 6],
          answerText: "B",
          answerLabel: "B",
          confidence: "high",
          shortExplanation: "Seven is odd."
        }
      ]
    }),
    ocrText
  );

  assert.equal(result.questionCount, 2);
  assert.equal(result.isBatch, true);
  assert.equal(result.questions[0].answerText, "Four");
  assert.equal(result.questions[1].answerText, "Seven");
  assert.equal(result.answerText, "Four");
  assert.deepEqual(result.questions[1].questionLineRefs, [4, 5, 6]);
});

test("parseAIResult keeps old single-question output backward compatible", () => {
  const result = parseAIResult(
    '{"answerText":"Paris","confidence":"high"}',
    "What is the capital of France?"
  );
  assert.equal(result.questionCount, 1);
  assert.equal(result.isBatch, false);
  assert.equal(result.questions[0].answerText, "Paris");
  assert.equal(result.answerText, "Paris");
});

test("parseAIResult infers batch scopes when the model omits line references", () => {
  const result = parseAIResult(
    JSON.stringify({
      questions: [
        {
          questionNumber: 1,
          answerText: "B",
          answerLabel: "B",
          confidence: "high"
        },
        {
          questionNumber: 2,
          answerText: "B",
          answerLabel: "B",
          confidence: "high"
        }
      ]
    }),
    "1. What is 2 + 2?\nA. Three\nB. Four\n2. What is 3 + 4?\nA. Six\nB. Seven"
  );

  assert.equal(result.questions[0].answerText, "Four");
  assert.equal(result.questions[1].answerText, "Seven");
  assert.deepEqual(result.questions[0].questionLineRefs, [1, 2, 3]);
  assert.deepEqual(result.questions[1].questionLineRefs, [4, 5, 6]);
});

test("parseAIResult resolves contradictions in single-select True/False questions containing typos", () => {
  const result = parseAIResult(
    JSON.stringify({
      answerLabel: "A",
      answerText: "Sai",
      confidence: "high",
      optionAnalysis: [
        { label: "A", text: "Sai", isCorrect: true },
        { label: "B", text: "Bung", isCorrect: true } // Contradictory option marked correct
      ]
    }),
    "stdin mặc định la man hình.\nA. Sai\nB. Bung"
  );

  assert.equal(result.answerLabel, "A");
  assert.equal(result.answerText, "Sai");
  assert.equal(result.answerSelections.length, 1);
  assert.equal(result.answerSelections[0].label, "A");
  assert.equal(result.answerSelections[0].text, "Sai");
});

test("parseAIResult prefers corrected feedback over contradictory single-select selections", () => {
  const result = parseAIResult(
    JSON.stringify({
      questions: [
        {
          questionNumber: 1,
          questionText: "[1] Côu 1.",
          questionLineRefs: [1],
          answerSelections: [
            { label: "A. Đúng", text: "A. Đúng" },
            { label: "B. Sai", text: "B. Sai" }
          ],
          requiredAnswerCount: 1,
          answerText: "B. Sai",
          answerLabel: "B. Sai",
          confidence: "medium",
          shortExplanation:
            "Lệnh help chỉ được sử dụng để hiển thị trợ giúp cho chương trình tích hợp, không phải cho shell.",
          coreKnowledge:
            "Lệnh help trong shell không hiển thị trợ giúp cho chương trình tích hợp.",
          notes:
            "Lưu ý: Đây là một câu hỏi về sự hiểu lầm về cách sử dụng lệnh help trong shell.",
          userAnswerEvaluation: {
            userAnswer: "B. Sai",
            isCorrect: false,
            feedback:
              "Đáp án đúng là A. Đúng. Lệnh help chỉ hiển thị trợ giúp cho chương trình tích hợp, không phải cho shell.",
            mistakePattern:
              "Quan hệ hiểu lầm về cách sử dụng lệnh help trong shell.",
            howToAvoidNextTime:
              "Xem lại cách sử dụng lệnh help trong shell để tránh hiểu lầm tương tự."
          }
        }
      ]
    }),
    "Côu 1.\nLệnh help dùng để hiển thị trợ giúp cho cóc chương trình tích hợp san trong shell.\nA. Đúng\nB. Sai"
  );

  assert.equal(result.requiredAnswerCount, 1);
  assert.equal(result.answerSelections.length, 1);
  assert.equal(result.answerSelections[0].label, "A");
  assert.equal(result.answerSelections[0].text, "Đúng");
  assert.equal(result.answerLabel, "A");
  assert.equal(result.answerText, "Đúng");
  assert.equal(result.answerCountMismatch, false);
});

test("parseAIResult reads Vietnamese correct-answer feedback with Đ diacritics", () => {
  const result = parseAIResult(
    JSON.stringify({
      questions: [
        {
          questionNumber: 1,
          questionText:
            "[2] Lệnh help dùng để hiển thị trợ giúp cho các chương trình tích hợp sẵn trong shell.",
          questionLineRefs: [2],
          answerSelections: [{ label: "A", text: "B. Sai" }],
          requiredAnswerCount: 1,
          answerText: "B. Sai",
          answerLabel: "B",
          confidence: "medium",
          shortExplanation:
            "Lệnh help chỉ hiển thị trợ giúp cho các chương trình tích hợp sẵn trong shell.",
          userAnswerEvaluation: {
            userAnswer: "B",
            isCorrect: false,
            feedback:
              "Đáp án đúng là A. Lệnh help chỉ hiển thị trợ giúp cho các chương trình tích hợp sẵn trong shell.",
            mistakePattern: "Đã nhầm về chức năng của lệnh help.",
            howToAvoidNextTime:
              "Xem lại định nghĩa của lệnh help trong shell để hiểu rõ hơn."
          }
        }
      ]
    }),
    "Câu 1.\nLệnh help dùng để hiển thị trợ giúp cho các chương trình tích hợp sẵn trong shell.\nA. Đúng\nB. Sai"
  );

  assert.equal(result.answerSelections.length, 1);
  assert.equal(result.answerSelections[0].label, "A");
  assert.equal(result.answerSelections[0].text, "Đúng");
  assert.equal(result.answerLabel, "A");
  assert.equal(result.answerText, "Đúng");
});

test("parseAIResult does not let compatibility summary override answerSelections", () => {
  const result = parseAIResult(
    JSON.stringify({
      questions: [
        {
          questionNumber: 1,
          questionText:
            "Lệnh help dùng để hiển thị trợ giúp cho các chương trình tích hợp sẵn trong shell.",
          answerSelections: [{ label: "A", text: "A. Đúng" }],
          requiredAnswerCount: 1,
          answerText: "B. Sai",
          answerLabel: "B",
          confidence: "medium",
          shortExplanation: "Đây là câu đúng."
        }
      ]
    }),
    "Câu 1.\nLệnh help dùng để hiển thị trợ giúp cho các chương trình tích hợp sẵn trong shell.\nA. Đúng\nB. Sai"
  );

  assert.equal(result.answerSelections.length, 1);
  assert.equal(result.answerSelections[0].label, "A");
  assert.equal(result.answerSelections[0].text, "Đúng");
  assert.equal(result.answerLabel, "A");
  assert.equal(result.answerText, "Đúng");
});
