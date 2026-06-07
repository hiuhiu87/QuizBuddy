import test from "node:test";
import assert from "node:assert/strict";
import {
  addSessionStudyNote,
  clearSessionStudyNotes
} from "../lib/study-notes.js";

test("session notes add, dedupe, increment, and clear concepts", () => {
  const first = addSessionStudyNote([], "Quadratic equations");
  const second = addSessionStudyNote(first, "quadratic equations");

  assert.equal(second.length, 1);
  assert.equal(second[0].count, 2);
  assert.deepEqual(clearSessionStudyNotes(), []);
});
