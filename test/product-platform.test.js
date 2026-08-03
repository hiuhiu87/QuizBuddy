import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateMetrics,
  createMetricEvent
} from "../lib/product-metrics.js";
import {
  createActionProposal,
  parseActionProposal
} from "../lib/action-proposal.js";

test("product metrics contain no content, URL, or prompt fields", () => {
  const event = createMetricEvent(
    {
      name: "skill_completed",
      skillId: "summarize",
      provider: "openai",
      durationMs: 123.6,
      content: "private",
      url: "https://private.example",
      prompt: "secret"
    },
    { idFactory: () => "1", now: "2026-06-14T00:00:00.000Z" }
  );
  assert.deepEqual(Object.keys(event), [
    "id",
    "name",
    "skillId",
    "provider",
    "durationMs",
    "success",
    "createdAt"
  ]);
  assert.equal(event.durationMs, 124);
  assert.equal(aggregateMetrics([event]).completed, 1);
});

test("action proposals are review-only and cannot execute", () => {
  const proposal = createActionProposal(
    {
      actionType: "form-draft",
      title: "Draft application",
      steps: [{ label: "Review name", value: "Example" }]
    },
    { idFactory: () => "1", now: "2026-06-14T00:00:00.000Z" }
  );
  assert.equal(proposal.status, "proposed");
  assert.equal(proposal.requiresConfirmation, true);
  assert.equal(proposal.executionAllowed, false);
});

test("action parser rejects prose and accepts checklist JSON", () => {
  assert.throws(() => parseActionProposal("not json"), /valid JSON/);
  const proposal = parseActionProposal(
    JSON.stringify({
      title: "Review",
      steps: [{ label: "Check source" }]
    })
  );
  assert.equal(proposal.steps[0].label, "Check source");
});
