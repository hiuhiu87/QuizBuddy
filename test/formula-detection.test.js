import test from "node:test";
import assert from "node:assert/strict";
import {
  detectFormulaSignals,
  extractFormulaBoundingBoxes,
  mergeTextAndFormulas,
  expandFormulasForPrompt,
  validateLatexSyntax,
  normalizeFormulaLatex,
  calculateFormulaConfidence,
  protectFormulaPlaceholders,
  restoreFormulaPlaceholders
} from "../lib/formula-detection.js";

test("detectFormulaSignals identifies quadratic formula in OCR text", () => {
  const result = detectFormulaSignals("Giải phương trình x² + 3x - 10 = 0");
  assert.equal(result.hasFormulas, true);
  assert.ok(result.confidence >= 25);
  assert.ok(result.signals.length > 0);
});

test("detectFormulaSignals ignores plain Vietnamese text", () => {
  const result = detectFormulaSignals("Thủ đô của Việt Nam là thành phố nào?");
  assert.equal(result.hasFormulas, false);
  assert.equal(result.confidence, 0);
});

test("detectFormulaSignals flags high math symbol density", () => {
  const result = detectFormulaSignals("∫ ∑ ∏ √");
  assert.equal(result.hasFormulas, true);
  assert.ok(result.signals.some(s => s.includes("HIGH_MATH_SYMBOL_DENSITY")));
});

test("detectFormulaSignals incorporates low-confidence words", () => {
  const ocrResult = {
    data: {
      words: [
        { text: "x", confidence: 50 },
        { text: "+", confidence: 40 },
        { text: "y", confidence: 55 }
      ]
    }
  };
  const result = detectFormulaSignals("x + y", ocrResult);
  assert.ok(result.signals.some(s => s.includes("LOW_CONFIDENCE_MATH_WORDS")));
});

test("extractFormulaBoundingBoxes returns empty for empty input", () => {
  const boxes = extractFormulaBoundingBoxes({ words: [] });
  assert.deepEqual(boxes, []);
});

test("extractFormulaBoundingBoxes finds and groups close bounding boxes", () => {
  const ocrResult = {
    words: [
      { text: "x", bbox: { x0: 10, y0: 10, x1: 20, y1: 30 } },
      { text: "+", bbox: { x0: 25, y0: 10, x1: 35, y1: 30 } },
      { text: "y", bbox: { x0: 40, y0: 10, x1: 50, y1: 30 } },
      { text: "plain", bbox: { x0: 100, y0: 10, x1: 150, y1: 30 } }
    ]
  };
  const boxes = extractFormulaBoundingBoxes(ocrResult, { width: 200, height: 100 });
  assert.equal(boxes.length, 1);
  assert.equal(boxes[0].x, 10);
  assert.equal(boxes[0].w, 40); // 10 to 50
  assert.deepEqual(boxes[0].triggerSymbols, ["x", "+", "y"]);
});

test("mergeTextAndFormulas falls back if no words provided", () => {
  const textOCR = "Solve equation:";
  const formulas = [{ latex: "x^2 = 4", placeholder: "$$FORMULA_1$$", bbox: {} }];
  const result = mergeTextAndFormulas(textOCR, formulas, null);
  assert.equal(result, "Solve equation:\n\n$$FORMULA_1$$");
});

test("mergeTextAndFormulas performs spatial layout reconstruction", () => {
  const textWords = [
    { text: "Solve", bbox: { x0: 10, y0: 10, x1: 50, y1: 30 } },
    { text: "garbage1", bbox: { x0: 60, y0: 10, x1: 80, y1: 30 } },
    { text: "garbage2", bbox: { x0: 85, y0: 10, x1: 105, y1: 30 } }
  ];
  const formulas = [
    { latex: "x + y = 2", placeholder: "$$FORMULA_1$$", bbox: { x0: 55, y0: 5, x1: 110, y1: 35 } }
  ];
  const result = mergeTextAndFormulas("Solve garbage1 garbage2", formulas, textWords);
  assert.equal(result, "Solve $$FORMULA_1$$");
});

test("expandFormulasForPrompt replaces placeholders with wrapped LaTeX", () => {
  const text = "Evaluate $$FORMULA_1$$ now.";
  const formulas = [{ latex: "\\frac{1}{2}", placeholder: "$$FORMULA_1$$" }];
  const result = expandFormulasForPrompt(text, formulas);
  assert.equal(result, "Evaluate \\(\\frac{1}{2}\\) now.");
});

test("validateLatexSyntax checks balanced braces", () => {
  assert.deepEqual(validateLatexSyntax("\\frac{1}{2}"), { valid: true, errors: [] });
  const result = validateLatexSyntax("\\frac{1}{2");
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
});

test("validateLatexSyntax checks balanced brackets", () => {
  assert.deepEqual(validateLatexSyntax("x_{i}[t]"), { valid: true, errors: [] });
  const result = validateLatexSyntax("x_{i}[t");
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
});

test("normalizeFormulaLatex removes various wrappers", () => {
  assert.equal(normalizeFormulaLatex("$$ \\sin(x) $$"), "\\sin(x)");
  assert.equal(normalizeFormulaLatex("$ x+y $"), "x+y");
  assert.equal(normalizeFormulaLatex("\\[ x^2 \\]"), "x^2");
  assert.equal(normalizeFormulaLatex("\\( \\sqrt{a} \\)"), "\\sqrt{a}");
});

test("normalizeFormulaLatex repairs common typos like square root", () => {
  assert.equal(normalizeFormulaLatex("\\sqrt5"), "\\sqrt{5}");
});

test("calculateFormulaConfidence bounds and validates", () => {
  assert.equal(calculateFormulaConfidence("\\frac{1}{2}", 0.95), 95);
  assert.equal(calculateFormulaConfidence("\\frac{1}{2", 95), 20); // syntax error penalty
  assert.equal(calculateFormulaConfidence("", 90), 0);
});

test("protectFormulaPlaceholders hides placeholders from normalization", () => {
  const text = "Solve $$FORMULA_1$$ and $$FORMULA_2$$.";
  const { protected: prot, tokens } = protectFormulaPlaceholders(text);
  assert.ok(!prot.includes("$$FORMULA_1$$"));
  assert.ok(prot.includes("__FORMULA_PLACEHOLDER_0__"));
  
  const restored = restoreFormulaPlaceholders(prot, tokens);
  assert.equal(restored, text);
});
