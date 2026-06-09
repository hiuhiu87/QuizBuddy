import test from "node:test";
import assert from "node:assert/strict";
import {
  chunkQuestionScopes,
  estimateQuestionCount,
  getQuestionScopeText,
  inferQuestionLineScopes,
  normalizeQuestionLineRefs,
  remapQuestionToSourceScope
} from "../lib/question-batch.js";

test("estimates numbered and question-mark batches", () => {
  assert.equal(
    estimateQuestionCount(
      "1. What is 2 + 2?\nA. 3\nB. 4\n2. What is 3 + 3?\nA. 5\nB. 6"
    ),
    2
  );
  assert.equal(
    estimateQuestionCount("What is one?\nWhat is two?\nWhat is three?"),
    3
  );
  assert.equal(estimateQuestionCount("What is one?"), 1);
});

test("normalizes line scopes and derives scoped OCR text", () => {
  const lines = [
    { lineNumber: 1, text: "Question one" },
    { lineNumber: 2, text: "A. First" },
    { lineNumber: 3, text: "Question two" }
  ];
  const refs = normalizeQuestionLineRefs([2, 1, 8, "2"], 3);
  assert.deepEqual(refs, [1, 2]);
  assert.equal(
    getQuestionScopeText(lines, refs, "fallback"),
    "Question one\nA. First"
  );
});

test("infers separate option scopes for numbered and question-mark batches", () => {
  assert.deepEqual(
    inferQuestionLineScopes(
      "1. First?\nA. One\nB. Two\n2. Second?\nA. Three\nB. Four"
    ),
    [
      [1, 2, 3],
      [4, 5, 6]
    ]
  );
  assert.deepEqual(
    inferQuestionLineScopes(
      "First question?\nA. One\nB. Two\nSecond question?\nA. Three\nB. Four"
    ),
    [
      [1, 2, 3],
      [4, 5, 6]
    ]
  );
  assert.deepEqual(
    inferQuestionLineScopes(
      "1. First?\n\nA. One\nB. Two\n\n2. Second?\nA. Three\nB. Four"
    ),
    [
      [1, 2, 3],
      [4, 5, 6]
    ]
  );
});

test("recognizes standalone Vietnamese question markers with OCR accent errors", () => {
  const ocrText = `Bai lãm
Côu 1.
Lệnh help dùng để hiển thị trợ giúp.
A. Đúng
B. Sai
Câu 2.
Ký tự thanh dọc biểu thị lựa chọn.
A. Đúng
B. Sai
Cau 3.
stdin mặc định là màn hình.
A. Sai
B. Đúng`;

  assert.equal(estimateQuestionCount(ocrText), 3);
  assert.deepEqual(inferQuestionLineScopes(ocrText), [
    [2, 3, 4, 5],
    [6, 7, 8, 9],
    [10, 11, 12, 13]
  ]);
});

test("remaps scoped question and source trace lines to the original OCR", () => {
  assert.deepEqual(
    remapQuestionToSourceScope(
      {
        questionLineRefs: [1, 2, 4],
        sourceTrace: [{ claim: "Answer", lineRefs: [2, 4] }]
      },
      [10, 11, 12, 13]
    ),
    {
      questionLineRefs: [10, 11, 13],
      sourceTrace: [{ claim: "Answer", lineRefs: [11, 13] }]
    }
  );
});

test("detects all seven questions from the reported Vietnamese OCR output", () => {
  const ocrText = `Bai lãm
Côu 1.
Lệnh help dùng để hiển thị trợ giúp cho cóc chương trình tích hợp sén trong shell.
A. Đúng
B. Sai
Câu 2.
Ky tự thanh dọc | biểu thị cdc lựa chọn loại trừ lẫn nhau.
A. Đúng
B. Sai
Câu 3.
Ký hiệu | dùng để chuyển stderr của lệnh trước sang stdin của lệnh sau.
A. Đúng
B. Sai
Câu 4.
stdin mặc định là màn hình.
A. Sai
B. Đúng
Cau 5.
Cóc tùy chọn luôn phỏi được viết tach rời, không thé kết hợp.
A. Đúng
B. Sai
Câu 6.
Có thể điềuhướng stdin, stdout va stderr.
A. Sai
B. Đúng
Cau 7.
Khi không chỉ định section_number, man sẽ hiển thi tốt cỏ cóc kết qua.
A. Đúng
B. Sai`;

  assert.equal(estimateQuestionCount(ocrText), 7);
  assert.deepEqual(inferQuestionLineScopes(ocrText), [
    [2, 3, 4, 5],
    [6, 7, 8, 9],
    [10, 11, 12, 13],
    [14, 15, 16, 17],
    [18, 19, 20, 21],
    [22, 23, 24, 25],
    [26, 27, 28, 29]
  ]);
});

test("chunks a seven-question recovery into two bounded model calls", () => {
  const scopes = Array.from({ length: 7 }, (_, index) => [index + 1]);
  assert.deepEqual(chunkQuestionScopes(scopes, 4), [
    [[1], [2], [3], [4]],
    [[5], [6], [7]]
  ]);
});

test("detects the reported eight-question OCR including Cãu!1", () => {
  const ocrText = `Cãu!1.

Lệnh help dùng để hiển thị trợ giúp cho các chương trình tích hợp sẵn trong shell.
A. Đúng
B. Sai

Cau 2.

Ky tự thanh dọc | biểu thi cdc lựa chọn loại trừ lẫn nhau.
A. Đúng
B. Sai

Câu 3.

Ky hiệu | dùng để chuyển stderr của lệnh trước sang stdin của lệnh sau.
A. Đúng
B. Sai

Câu 4.

stdin mặc định lờ mờn hình.
A. Sai
B. Đúng

Cau 5.

Cac tùy chọn luôn phỏi được viết tach rời, không thể kết hợp.
A. Đúng
B. Sai

Cau 6.

Có thể diéuhudng stdin, stdout va stderr.
A. Sai
B. Đúng

Câu 7.

Khi không chỉ định section _number, man sẽ hiển thị tốt cỏ cóc kết qua.
A. Đúng
B. Sai

Cau 8.

Lệnh info là một giỏi pháp thay thé cho man.
A. Đúng
B. Sai`;

  assert.equal(estimateQuestionCount(ocrText), 8);
  assert.deepEqual(inferQuestionLineScopes(ocrText), [
    [1, 2, 3, 4],
    [5, 6, 7, 8],
    [9, 10, 11, 12],
    [13, 14, 15, 16],
    [17, 18, 19, 20],
    [21, 22, 23, 24],
    [25, 26, 27, 28],
    [29, 30, 31, 32]
  ]);
  assert.equal(
    chunkQuestionScopes(inferQuestionLineScopes(ocrText), 2).length,
    4
  );
});

test("infers a missing question-one number from a standalone Cau marker", () => {
  const ocrText = `Cau.

Lệnh help dùng để hiển thị trợ giúp cho cóc chương trình tích hợp san trong shell.
A. Đúng
B. Sai

Câu 2.

Ký tự thanh dọc | biểu thị cóc lựa chọn loại trừ lẫn nhau.
A. Đúng
B. Sai

Côu 3.

Ký hiệu | dùng để chuyển stderr của lệnh trước sang stdin của lệnh sau.
A. Đúng
B. Sai`;

  assert.equal(estimateQuestionCount(ocrText), 3);
  assert.deepEqual(inferQuestionLineScopes(ocrText), [
    [1, 2, 3, 4],
    [5, 6, 7, 8],
    [9, 10, 11, 12]
  ]);
});
