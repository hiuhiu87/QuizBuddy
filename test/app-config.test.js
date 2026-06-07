import test from "node:test";
import assert from "node:assert/strict";
import {
  ANALYSIS_MODES,
  DEFAULT_ANALYSIS_MODE,
  DEFAULT_MODEL_ID,
  DEFAULT_SUBJECT_PRESET,
  MODEL_PROFILES,
  SUBJECT_PRESETS,
  getModelProfile,
  getSubjectPreset,
  getTesseractLanguages,
  normalizeAnalysisMode,
  normalizeOCRLanguage
} from "../lib/app-config.js";

test("model selection falls back to the balanced profile", () => {
  assert.equal(getModelProfile("missing-model").id, DEFAULT_MODEL_ID);
  assert.equal(MODEL_PROFILES.length, 3);
  assert.equal(getModelProfile(DEFAULT_MODEL_ID).label, "Balanced");
  assert.match(MODEL_PROFILES[0].label, /Lower Accuracy/);
  assert.match(MODEL_PROFILES[2].label, /Recommended/);
  assert.equal(MODEL_PROFILES[2].parameterLabel, "3B");
});

test("OCR language selection maps auto to Vietnamese and English", () => {
  assert.equal(normalizeOCRLanguage("unsupported"), "auto");
  assert.equal(getTesseractLanguages("auto"), "vie+eng");
  assert.equal(getTesseractLanguages("vie"), "vie");
  assert.equal(getTesseractLanguages("eng"), "eng");
});

test("analysis mode and subject presets normalize unsupported values", () => {
  assert.equal(normalizeAnalysisMode("missing"), DEFAULT_ANALYSIS_MODE);
  assert.equal(normalizeAnalysisMode("quick"), "quick");
  assert.equal(getSubjectPreset("missing").id, DEFAULT_SUBJECT_PRESET);
  assert.equal(ANALYSIS_MODES.length, 2);
  assert.equal(SUBJECT_PRESETS.length, 6);
});
