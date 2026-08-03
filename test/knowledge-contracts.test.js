import test from "node:test";
import assert from "node:assert/strict";
import {
  KNOWLEDGE_SCHEMA_VERSION,
  createArtifact,
  createContextItem,
  createWorkspace,
  stripTransientContext,
  validateRunSkillTask
} from "../lib/knowledge-contracts.js";

const now = "2026-06-14T00:00:00.000Z";
const options = { now, idFactory: () => "fixed" };

test("knowledge contracts normalize versioned records", () => {
  const context = createContextItem(
    {
      type: "page",
      title: " Example ",
      text: " Page text ",
      source: { url: "https://example.com/path", pageTitle: "Page" }
    },
    options
  );
  const workspace = createWorkspace({}, options);
  const artifact = createArtifact(
    {
      workspaceId: workspace.id,
      skillId: "summarize",
      content: "Summary",
      sourceRefs: [context.id, context.id]
    },
    options
  );

  assert.equal(context.schemaVersion, KNOWLEDGE_SCHEMA_VERSION);
  assert.equal(context.id, "ctx_fixed");
  assert.equal(context.source.url, "https://example.com/path");
  assert.equal(workspace.id, "ws_fixed");
  assert.deepEqual(artifact.sourceRefs, ["ctx_fixed"]);
});

test("context rejects empty and unsafe image input", () => {
  assert.throws(() => createContextItem({ type: "selection" }), /text or an image/);
  assert.throws(
    () => createContextItem({ type: "image", imageDataUrl: "javascript:x" }),
    /text or an image/
  );
});

test("skill task validation enforces protocol and normalizes context", () => {
  const result = validateRunSkillTask({
    type: "QB_RUN_SKILL",
    protocolVersion: 1,
    taskId: "task-1",
    skillId: "explain",
    provider: "openai",
    context: {
      id: "ctx-1",
      type: "selection",
      text: "Selected content",
      source: { url: "https://example.com" }
    }
  });

  assert.equal(result.provider, "openai");
  assert.equal(result.context[0].id, "ctx-1");
  assert.throws(
    () => validateRunSkillTask({ ...result, protocolVersion: 2 }),
    /protocol version/
  );
});

test("persistent context strips screenshots by default", () => {
  const context = createContextItem({
    id: "ctx-image",
    type: "crop",
    text: "OCR text",
    imageDataUrl: "data:image/png;base64,AA=="
  });
  assert.equal(stripTransientContext(context).imageDataUrl, undefined);
});
