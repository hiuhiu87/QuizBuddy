import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MODEL_ID,
  MODEL_PROFILES,
  getModelProfile,
  getTesseractLanguages,
  normalizeOCRLanguage
} from "../lib/app-config.js";

test("model selection falls back to the balanced profile", () => {
  assert.equal(getModelProfile("missing-model").id, DEFAULT_MODEL_ID);
  assert.equal(MODEL_PROFILES.length, 2);
});

test("OCR language selection maps auto to Vietnamese and English", () => {
  assert.equal(normalizeOCRLanguage("unsupported"), "auto");
  assert.equal(getTesseractLanguages("auto"), "vie+eng");
  assert.equal(getTesseractLanguages("vie"), "vie");
  assert.equal(getTesseractLanguages("eng"), "eng");
});
