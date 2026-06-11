import test from "node:test";
import assert from "node:assert/strict";
import {
  containsLatexMarkers,
  parseTextWithFormulas,
  renderFormulaElement,
  renderTextWithFormulas,
  buildKaTeXFontFaceCSS
} from "../lib/formula-render.js";

test("containsLatexMarkers detects inline and block LaTeX tags", () => {
  assert.equal(containsLatexMarkers("Solve \\(x+y\\)"), true);
  assert.equal(containsLatexMarkers("Solve \\[x^2\\]"), true);
  assert.equal(containsLatexMarkers("Solve x + y"), false);
});

test("parseTextWithFormulas tokenizes text and formulas", () => {
  const text = "Solve \\(x+y = 2\\) or \\[a^2 + b^2 = c^2\\] today.";
  const tokens = parseTextWithFormulas(text);

  assert.equal(tokens.length, 5);
  assert.deepEqual(tokens[0], { type: "text", content: "Solve " });
  assert.deepEqual(tokens[1], { type: "formula", content: "x+y = 2", displayMode: false });
  assert.deepEqual(tokens[2], { type: "text", content: " or " });
  assert.deepEqual(tokens[3], { type: "formula", content: "a^2 + b^2 = c^2", displayMode: true });
  assert.deepEqual(tokens[4], { type: "text", content: " today." });
});

test("parseTextWithFormulas handles malformed markers gracefully", () => {
  const text = "Solve \\(x+y and \\[a^2\\]";
  const tokens = parseTextWithFormulas(text);

  // Since \\( has no closing marker, it treats the remainder starting from \\( as text
  assert.equal(tokens.length, 2);
  assert.deepEqual(tokens[0], { type: "text", content: "Solve " });
  assert.deepEqual(tokens[1], { type: "text", content: "\\(x+y and \\[a^2\\]" });
});

test("renderFormulaElement returns mock structure in non-browser env", () => {
  const inlineElement = renderFormulaElement("x+y", false);
  assert.equal(inlineElement.tagName, "SPAN");
  assert.equal(inlineElement.className, "qb-formula qb-formula-inline qb-formula-entering");
  assert.equal(inlineElement.textContent, "\\(x+y\\)");
  assert.equal(inlineElement.isMock, true);
  assert.equal(inlineElement.hasBadge, false);

  const blockElement = renderFormulaElement("x^2", true);
  assert.equal(blockElement.className, "qb-formula qb-formula-block qb-formula-entering");
  assert.equal(blockElement.textContent, "\\[x^2\\]");
  assert.equal(blockElement.hasBadge, true);
});

test("renderTextWithFormulas returns mock DocumentFragment in non-browser env", () => {
  const text = "Solve \\(x+y\\) now.";
  const fragment = renderTextWithFormulas(text);

  assert.ok(fragment.childNodes);
  assert.equal(fragment.childNodes.length, 3);
  assert.deepEqual(fragment.childNodes[0], { tagName: "TEXT", textContent: "Solve " });
  assert.deepEqual(fragment.childNodes[1], {
    tagName: "SPAN",
    className: "qb-formula qb-formula-inline qb-formula-entering",
    textContent: "x+y",
    isFormula: true,
    hasBadge: false
  });
  assert.deepEqual(fragment.childNodes[2], { tagName: "TEXT", textContent: " now." });
});

test("buildKaTeXFontFaceCSS generates valid CSS containing KaTeX font names", () => {
  const css = buildKaTeXFontFaceCSS();
  assert.ok(typeof css === "string");
  assert.ok(css.includes("@font-face"));
  assert.ok(css.includes("KaTeX_Main-Regular"));
  assert.ok(css.includes("woff2"));
});
