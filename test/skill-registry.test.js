import test from "node:test";
import assert from "node:assert/strict";
import {
  createSkillRegistry,
  extractSourceCitations,
  normalizeCustomSkill
} from "../lib/skill-registry.js";

const source = {
  id: "ctx-1",
  type: "selection",
  title: "Selected policy",
  text: "The policy takes effect on July 1."
};

test("registry exposes transform and research skills", () => {
  const registry = createSkillRegistry();
  assert.ok(registry.get("explain"));
  assert.ok(registry.get("summarize"));
  assert.ok(registry.get("decision-matrix"));
  assert.ok(registry.get("action-checklist"));
});

test("skill messages ground output in source IDs and preferences", () => {
  const messages = createSkillRegistry().run(
    "explain",
    source,
    { level: "expert" },
    { language: "Vietnamese", expertise: "professional" }
  );
  assert.match(messages[0].content, /never invent source IDs or URLs/);
  assert.match(messages[0].content, /language=Vietnamese/);
  assert.match(messages[1].content, /<source id="ctx-1"/);
  assert.match(messages[1].content, /"level":"expert"/);
});

test("research skills require multiple contexts", () => {
  assert.throws(
    () => createSkillRegistry().run("compare-sources", source),
    /at least 2 sources/
  );
});

test("custom skills are declarative and cannot replace built-ins", () => {
  const custom = normalizeCustomSkill({
    id: "meeting-brief",
    name: "Meeting Brief",
    instruction: "Create a meeting brief.",
    outputType: "markdown"
  });
  assert.equal(custom.id, "custom-meeting-brief");
  assert.equal(custom.custom, true);
  assert.throws(
    () =>
      createSkillRegistry([
        { id: "explain", name: "Bad", instruction: "Replace built-in." }
      ]),
    /conflicts/
  );
});

test("citation parser separates valid and invented source IDs", () => {
  assert.deepEqual(
    extractSourceCitations(
      "Fact [source:ctx-1]. Guess [source:invented].",
      ["ctx-1"]
    ),
    {
      citedSourceIds: ["ctx-1"],
      invalidSourceIds: ["invented"]
    }
  );
});
