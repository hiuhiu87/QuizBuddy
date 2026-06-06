import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateCropPixels,
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
    "Question?\nA. One\n\nB. Two"
  );
});

test("normalizeOCRText preserves Vietnamese accents in NFC form", () => {
  assert.equal(
    normalizeOCRText("Thu\u031Bo\u031Bng ma\u0323i điẹ\u0302n tu\u031B\u0309"),
    "Thương mại điện tử"
  );
});

test("parseAIResult accepts JSON wrapped in model chatter", () => {
  assert.deepEqual(
    parseAIResult(
      'Result: {"answerText":"Two","answerLabel":"B","confidence":"HIGH","shortExplanation":"Because.","coreKnowledge":"Rule","notes":"Check units."}',
      "Question?\nA. One\nB. Two"
    ),
    {
      answerText: "Two",
      answerLabel: "B",
      confidence: "high",
      shortExplanation: "Because.",
      coreKnowledge: "Rule",
      notes: "Check units."
    }
  );
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

test("parseAIResult expands a label-only answer using OCR choice text", () => {
  const result = parseAIResult(
    '{"answerText":"B","answerLabel":"B","confidence":"high","shortExplanation":"","coreKnowledge":"","notes":""}',
    "Which value is even?\nA. Three\nB. Four\nC. Five"
  );

  assert.equal(result.answerText, "Four");
  assert.equal(result.answerLabel, "B");
});

test("parseAIResult returns a safe fallback for malformed output", () => {
  assert.equal(parseAIResult("not json").answerText, "Unknown");
});
