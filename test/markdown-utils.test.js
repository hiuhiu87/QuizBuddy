import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeMarkdownUrl,
  parseMarkdownBlocks,
  parseMarkdownInline
} from "../lib/markdown-utils.js";

test("Markdown parser recognizes common AI response blocks", () => {
  const blocks = parseMarkdownBlocks(`# Summary

**Important** text.

- First
- Second

| Name | Value |
| --- | --- |
| A | 1 |

\`\`\`js
const value = 1;
\`\`\``);

  assert.deepEqual(
    blocks.map((block) => block.type),
    ["heading", "paragraph", "list", "table", "code"]
  );
  assert.deepEqual(blocks[2].items, ["First", "Second"]);
  assert.deepEqual(blocks[3].headers, ["Name", "Value"]);
  assert.equal(blocks[4].language, "js");
});

test("inline Markdown parser recognizes formatting and safe links", () => {
  const tokens = parseMarkdownInline(
    "**Bold** *italic* `code` [source](https://example.com)"
  );
  assert.deepEqual(
    tokens.filter((token) => token.type !== "text").map((token) => token.type),
    ["strong", "emphasis", "code", "link"]
  );
  assert.equal(tokens.at(-1).href, "https://example.com/");
});

test("Markdown URLs reject script and data protocols", () => {
  assert.equal(normalizeMarkdownUrl("javascript:alert(1)"), "");
  assert.equal(normalizeMarkdownUrl("data:text/html,test"), "");
  assert.equal(normalizeMarkdownUrl("mailto:test@example.com"), "mailto:test@example.com");
});
