import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSourceTrace,
  numberOcrLines
} from "../lib/source-trace.js";

test("numberOcrLines preserves English, Vietnamese, German, and answer markers", () => {
  const result = numberOcrLines(
    "Which sentence?\r\nA. Hello\n\nTiếng Việt\rWelche Antwort?\nB) Tschüss"
  );
  assert.equal(
    result.numberedText,
    "[1] Which sentence?\n[2] A. Hello\n[3] Tiếng Việt\n[4] Welche Antwort?\n[5] B) Tschüss"
  );
  assert.equal(result.lines.length, 5);
});

test("numberOcrLines removes empty lines without numbering them", () => {
  assert.deepEqual(numberOcrLines("\n  \nQuestion\n\nAnswer\n").lines, [
    { lineNumber: 1, text: "Question" },
    { lineNumber: 2, text: "Answer" }
  ]);
});

test("normalizeSourceTrace filters invalid line references without failing", () => {
  assert.deepEqual(
    normalizeSourceTrace(
      [
        {
          claim: "Answer B is visible.",
          lineRefs: [2, 9, "2", -1],
          reason: "The option is on line 2."
        },
        { claim: "", lineRefs: [1], reason: "" }
      ],
      3
    ),
    [
      {
        claim: "Answer B is visible.",
        lineRefs: [2],
        reason: "The option is on line 2."
      }
    ]
  );
});
