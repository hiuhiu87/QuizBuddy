import test from "node:test";
import assert from "node:assert/strict";
import { calculateOverallReliability } from "../lib/reliability.js";

test("low OCR confidence forces low reliability", () => {
  assert.equal(
    calculateOverallReliability({
      ocrConfidence: 69,
      aiConfidence: "high",
      parseStatus: "parsed"
    }).level,
    "low"
  );
});

test("low AI confidence forces low reliability", () => {
  assert.equal(
    calculateOverallReliability({
      ocrConfidence: 95,
      aiConfidence: "low",
      parseStatus: "parsed"
    }).level,
    "low"
  );
});

test("high OCR and AI confidence allow high reliability", () => {
  assert.equal(
    calculateOverallReliability({
      ocrConfidence: 90,
      aiConfidence: "high",
      parseStatus: "parsed",
      answerWasExpandedFromOption: false
    }).level,
    "high"
  );
});

test("fallback parse forces low reliability", () => {
  assert.equal(
    calculateOverallReliability({
      ocrConfidence: 95,
      aiConfidence: "high",
      parseStatus: "fallback"
    }).level,
    "low"
  );
});

test("edited OCR adds an explicit reason", () => {
  const result = calculateOverallReliability({
    aiConfidence: "high",
    parseStatus: "parsed",
    wasOcrEdited: true
  });

  assert.ok(result.reasons.some((reason) => /manually edited/.test(reason)));
});
