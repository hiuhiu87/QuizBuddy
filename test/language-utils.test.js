import test from "node:test";
import assert from "node:assert/strict";
import {
  detectQuestionLanguage,
  getResponseLanguageInstruction,
  resultMatchesQuestionLanguage
} from "../lib/language-utils.js";

test("detectQuestionLanguage recognizes Vietnamese OCR", () => {
  assert.equal(
    detectQuestionLanguage(
      "Điều gì xảy ra khi một tiến trình chuyển sang trạng thái Waiting?"
    ),
    "vi"
  );
});

test("Vietnamese response instruction is explicit", () => {
  assert.match(
    getResponseLanguageInstruction("vi"),
    /natural Vietnamese/
  );
});

test("result language check rejects English explanations for Vietnamese OCR", () => {
  assert.equal(
    resultMatchesQuestionLanguage(
      {
        shortExplanation:
          "The process is waiting because an input output operation has not completed.",
        coreKnowledge: "Operating system process states",
        notes: "Remember the difference between ready and waiting."
      },
      "vi"
    ),
    false
  );
});

test("result language check accepts Vietnamese explanations with technical terms", () => {
  assert.equal(
    resultMatchesQuestionLanguage(
      {
        shortExplanation:
          "Tiến trình chuyển sang Waiting vì đang chờ thao tác I/O hoàn thành.",
        coreKnowledge: "Các trạng thái của tiến trình trong hệ điều hành",
        notes: "Phân biệt Waiting với Ready."
      },
      "vi"
    ),
    true
  );
});
