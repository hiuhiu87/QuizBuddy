import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceStore } from "../lib/workspace-store.js";
import {
  exportWorkspaceBundle,
  importWorkspaceBundle,
  isExpired,
  searchWorkspaceRecords,
  toMarkdownExport
} from "../lib/workspace-utils.js";

const oldDate = "2026-05-01T00:00:00.000Z";
const currentDate = "2026-06-14T00:00:00.000Z";

test("retention detects expired records", () => {
  const now = new Date(currentDate).getTime();
  assert.equal(isExpired({ updatedAt: oldDate }, "30-days", now), true);
  assert.equal(isExpired({ updatedAt: currentDate }, "30-days", now), false);
  assert.equal(isExpired({ updatedAt: oldDate }, "forever", now), false);
});

test("workspace search matches all terms and prioritizes pinned records", () => {
  const records = [
    { id: "1", title: "Quarterly market brief", content: "Revenue", pinned: false },
    { id: "2", title: "Market research", content: "Quarterly revenue", pinned: true }
  ];
  assert.deepEqual(
    searchWorkspaceRecords(records, "market revenue").map((item) => item.id),
    ["2", "1"]
  );
});

test("workspace export strips images and unknown secrets", () => {
  const bundle = exportWorkspaceBundle(
    {
      workspaces: [
        {
          id: "ws-1",
          title: "Research",
          contextIds: ["ctx-1"],
          artifactIds: ["art-1"],
          createdAt: currentDate,
          updatedAt: currentDate
        }
      ],
      contexts: [
        {
          id: "ctx-1",
          type: "crop",
          text: "Visible text",
          imageDataUrl: "data:image/png;base64,AA==",
          source: { url: "https://example.com", capturedAt: currentDate },
          apiKey: "secret"
        }
      ],
      artifacts: [
        {
          id: "art-1",
          workspaceId: "ws-1",
          skillId: "summarize",
          title: "Summary",
          content: "Result",
          sourceRefs: ["ctx-1"],
          createdAt: currentDate,
          updatedAt: currentDate
        }
      ]
    },
    { now: currentDate }
  );
  const serialized = JSON.stringify(bundle);
  assert.doesNotMatch(serialized, /data:image/);
  assert.doesNotMatch(serialized, /secret/);
  assert.equal(importWorkspaceBundle(bundle).artifacts[0].id, "art-1");
});

test("Markdown export links artifacts to captured sources", () => {
  const markdown = toMarkdownExport(
    { title: "Research" },
    [
      {
        id: "ctx-1",
        title: "Source",
        source: { url: "https://example.com" }
      }
    ],
    [{ title: "Summary", content: "Finding.", sourceRefs: ["ctx-1"] }]
  );
  assert.match(markdown, /# Research/);
  assert.match(markdown, /\[Source\]\(https:\/\/example\.com\)/);
});

test("session-only store never opens IndexedDB", async () => {
  let opened = false;
  const store = new WorkspaceStore({
    sessionOnly: true,
    indexedDB: { open: () => (opened = true) }
  });
  await store.put("artifacts", { id: "art-1", content: "Local" });
  assert.equal((await store.get("artifacts", "art-1")).content, "Local");
  assert.equal((await store.getAll("artifacts")).length, 1);
  assert.equal(opened, false);
});
