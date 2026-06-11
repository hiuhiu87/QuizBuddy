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

test("question quality warning and analyze-anyway downgrade reliability", () => {
  const warning = calculateOverallReliability({
    ocrConfidence: 95,
    aiConfidence: "high",
    parseStatus: "parsed",
    answerWasExpandedFromOption: false,
    wasOcrEdited: false,
    questionQuality: { status: "warning" }
  });
  assert.equal(warning.level, "medium");

  const bad = calculateOverallReliability({
    ocrConfidence: 95,
    aiConfidence: "high",
    parseStatus: "parsed",
    answerWasExpandedFromOption: false,
    wasOcrEdited: false,
    questionQuality: { status: "bad" },
    analyzeAnyway: true
  });
  assert.equal(bad.level, "low");
});

test("wrong multiple-select answer count forces low reliability", () => {
  const result = calculateOverallReliability({
    ocrConfidence: 95,
    aiConfidence: "high",
    parseStatus: "parsed",
    answerCountMismatch: true,
    requiredAnswerCount: 3
  });

  assert.equal(result.level, "low");
  assert.ok(result.reasons.some((reason) => /requires 3 answers/.test(reason)));
});

test("low Math OCR formula confidence downgrades reliability", () => {
  const result = calculateOverallReliability({
    ocrConfidence: 95,
    aiConfidence: "high",
    parseStatus: "parsed",
    formulas: [{ confidence: 50 }]
  });

  assert.equal(result.level, "low");
  assert.ok(result.reasons.some((reason) => /Low math formula OCR confidence/.test(reason)));
});

test("high Math OCR formula confidence permits high reliability", () => {
  const result = calculateOverallReliability({
    ocrConfidence: 90,
    aiConfidence: "high",
    parseStatus: "parsed",
    formulas: [{ confidence: 95 }]
  });

  assert.equal(result.level, "high");
});
