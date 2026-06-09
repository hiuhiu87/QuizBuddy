import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_CUSTOM_INSTRUCTION_LENGTH,
  normalizeCustomInstructions,
  resolveCustomInstruction,
  updateCustomInstruction
} from "../lib/custom-instructions.js";

test("custom instruction storage normalizes corrupt values", () => {
  assert.deepEqual(normalizeCustomInstructions("corrupt"), {
    enabled: false,
    global: "",
    bySubject: {},
    updatedAt: 0
  });
});

test("custom instructions enforce length, enablement, and subject override", () => {
  let value = updateCustomInstruction(null, {
    instruction: "Global",
    enabled: true
  });
  value = updateCustomInstruction(value, {
    instruction: "German detail",
    scope: "subject",
    subject: "german",
    enabled: true
  });
  assert.equal(resolveCustomInstruction(value, "german"), "German detail");
  assert.equal(resolveCustomInstruction(value, "math"), "Global");
  assert.equal(
    normalizeCustomInstructions({
      global: "x".repeat(MAX_CUSTOM_INSTRUCTION_LENGTH + 10)
    }).global.length,
    MAX_CUSTOM_INSTRUCTION_LENGTH
  );
  assert.equal(resolveCustomInstruction({ ...value, enabled: false }, "german"), "");
});
