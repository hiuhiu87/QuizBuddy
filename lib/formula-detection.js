/**
 * Local Math & Formula OCR — Formula Detection Module
 * Pure functions for detecting, normalizations, and spatial merging.
 */

export const MATH_SYMBOL_PATTERN =
  /[∫∑∏√∞±≤≥≠≈∂∇∈∉⊂⊃∪∩×÷αβγδεθλμπσφωΔΩ²³⁴ⁿ₀₁₂]/g;

export const FORMULA_TRIGGER_PATTERNS = [
  /\b\d+\s*[\/\\]\s*\d+\b/,        // Text fractions: 1/2, 3\4
  /[a-z]\s*[²³⁴ⁿ]\b/i,             // Unicode exponents
  /\b(?:sin|cos|tan|log|ln|lim|max|min)\s*[\(\\{]/i,  // Math functions
  /[=<>≤≥≠]\s*[+-]?\d/,            // Equations
  /\b\d+\s*[×·∗]\s*\d+/,            // Special multiplication
  /_{.+}|\\{.+}/,                  // Subscript/superscript
  /\b(?:dx|dy|dt|dθ)\b/,           // Differentials
  /(?:mol|atm|kPa|°C|°F|Ω|Hz)\b/   // Scientific units
];

/**
 * Detects heuristic signals that indicate the OCR text contains mathematical formulas.
 *
 * @param {string} ocrText - Raw OCR text
 * @param {object} [ocrResult] - Raw Tesseract result
 * @returns {{ hasFormulas: boolean, confidence: number, signals: string[] }}
 */
export function detectFormulaSignals(ocrText, ocrResult) {
  const text = String(ocrText || "");
  const signals = [];
  let score = 0;

  // 1. Math symbols pattern match
  const symbolMatches = text.match(MATH_SYMBOL_PATTERN);
  if (symbolMatches && symbolMatches.length > 0) {
    const symbolDensity = symbolMatches.length / text.length;
    score += Math.min(40, symbolMatches.length * 5);
    signals.push(`MATH_SYMBOLS_FOUND (${symbolMatches.length})`);
    if (symbolDensity > 0.02) {
      score += 15;
      signals.push(`HIGH_MATH_SYMBOL_DENSITY (${symbolDensity.toFixed(3)})`);
    }
  }

  // 2. Trigger patterns match
  let triggerCount = 0;
  for (const pattern of FORMULA_TRIGGER_PATTERNS) {
    if (pattern.test(text)) {
      triggerCount++;
      score += 15;
    }
  }
  if (triggerCount > 0) {
    signals.push(`TRIGGER_PATTERNS_MATCHED (${triggerCount})`);
  }

  // 3. Tesseract confidence checks (if word results are present)
  // Math symbols usually have lower confidence in text-only models
  const words = ocrResult?.data?.words || ocrResult?.words;
  if (words && words.length > 0) {
    let lowConfidenceMathWords = 0;
    for (const w of words) {
      const wordText = w.text || "";
      const isMathy = MATH_SYMBOL_PATTERN.test(wordText) || /[\d+\-*/=<>^_{}]/.test(wordText);
      if (isMathy && w.confidence < 70) {
        lowConfidenceMathWords++;
      }
    }
    if (lowConfidenceMathWords > 0) {
      score += Math.min(20, lowConfidenceMathWords * 4);
      signals.push(`LOW_CONFIDENCE_MATH_WORDS (${lowConfidenceMathWords})`);
    }
  }

  return {
    hasFormulas: score >= 25,
    confidence: Math.max(0, Math.min(100, score)),
    signals
  };
}

/**
 * Extracts formula bounding boxes from Tesseract word/symbol data.
 *
 * @param {object} ocrResult - Raw Tesseract result
 * @param {{ width: number, height: number }} imageSize
 * @returns {Array<{ x: number, y: number, w: number, h: number, triggerSymbols: string[] }>}
 */
export function extractFormulaBoundingBoxes(ocrResult, imageSize) {
  const words = ocrResult?.data?.words || ocrResult?.words || [];
  if (words.length === 0) return [];

  const candidateBoxes = [];

  for (const word of words) {
    const text = word.text || "";
    const isMathSymbol = MATH_SYMBOL_PATTERN.test(text);
    const hasMathTriggers = FORMULA_TRIGGER_PATTERNS.some(p => p.test(text));
    const isEquationChar = /[\u002B-\u002F\u003C-\u003F^_{}\\]/.test(text); // + , - . / < = > ? etc.
    const isSingleLetter = /^[a-z]$/i.test(text);
    const isDigitWord = /^\d+$/.test(text);

    if (isMathSymbol || hasMathTriggers || isEquationChar || isSingleLetter || isDigitWord) {
      const bbox = word.bbox;
      if (bbox) {
        const x = bbox.x0 !== undefined ? bbox.x0 : (bbox.x || 0);
        const y = bbox.y0 !== undefined ? bbox.y0 : (bbox.y || 0);
        const w = bbox.x1 !== undefined ? (bbox.x1 - bbox.x0) : (bbox.w || 0);
        const h = bbox.y1 !== undefined ? (bbox.y1 - bbox.y0) : (bbox.h || 0);

        const isTrueTrigger = isMathSymbol || hasMathTriggers || isEquationChar;

        candidateBoxes.push({
          x, y, w, h,
          triggerSymbols: [text],
          hasTrueTrigger: isTrueTrigger
        });
      }
    }
  }

  if (candidateBoxes.length === 0) return [];

  // Group overlapping or horizontally close boxes on the same line
  const mergedBoxes = [];
  const used = new Set();

  for (let i = 0; i < candidateBoxes.length; i++) {
    if (used.has(i)) continue;

    let current = { ...candidateBoxes[i] };
    used.add(i);

    let foundMerge = true;
    while (foundMerge) {
      foundMerge = false;
      for (let j = 0; j < candidateBoxes.length; j++) {
        if (used.has(j)) continue;

        const other = candidateBoxes[j];
        
        // Check if on similar horizontal line (vertical overlap)
        const verticalOverlap = Math.max(0, Math.min(current.y + current.h, other.y + other.h) - Math.max(current.y, other.y));
        const minHeight = Math.min(current.h, other.h);
        
        if (verticalOverlap > minHeight * 0.4) {
          // Check horizontal distance
          const dist = Math.max(0, Math.max(current.x, other.x) - Math.min(current.x + current.w, other.x + other.w));
          // If distance is less than 3x average height, merge
          if (dist < minHeight * 3.0) {
            // Merge bounds
            const x0 = Math.min(current.x, other.x);
            const y0 = Math.min(current.y, other.y);
            const x1 = Math.max(current.x + current.w, other.x + other.w);
            const y1 = Math.max(current.y + current.h, other.y + other.h);

            current.x = x0;
            current.y = y0;
            current.w = x1 - x0;
            current.h = y1 - y0;
            current.triggerSymbols.push(...other.triggerSymbols);
            if (other.hasTrueTrigger) {
              current.hasTrueTrigger = true;
            }

            used.add(j);
            foundMerge = true;
          }
        }
      }
    }
    mergedBoxes.push(current);
  }

  // Filter merged boxes: must contain at least one true trigger
  return mergedBoxes.filter(box => box.hasTrueTrigger);
}

function getCoords(bbox) {
  if (!bbox) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  if (bbox.x0 !== undefined) {
    return {
      x0: bbox.x0,
      y0: bbox.y0,
      x1: bbox.x1,
      y1: bbox.y1
    };
  }
  return {
    x0: bbox.x || 0,
    y0: bbox.y || 0,
    x1: (bbox.x || 0) + (bbox.w || 0),
    y1: (bbox.y || 0) + (bbox.h || 0)
  };
}

function isOverlapping(boxA, boxB) {
  const a = getCoords(boxA);
  const b = getCoords(boxB);

  const xOver = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const yOver = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const overlapArea = xOver * yOver;

  if (overlapArea <= 0) return false;

  const areaA = (a.x1 - a.x0) * (a.y1 - a.y0);
  if (areaA <= 0) return false;

  return (overlapArea / areaA) > 0.3;
}

function getItemLineInfo(item) {
  const coords = getCoords(item.bbox);
  return {
    item,
    y0: coords.y0,
    y1: coords.y1,
    h: coords.y1 - coords.y0,
    yCenter: (coords.y0 + coords.y1) / 2,
    x0: coords.x0,
    xCenter: (coords.x0 + coords.x1) / 2
  };
}

/**
 * Merges Tesseract plain text and LaTeX formulas using a spatial layout algorithm.
 *
 * @param {string} textOCR - Original normalized OCR text
 * @param {Array<{ latex: string, placeholder: string, bbox: object }>} formulas
 * @param {Array<object>} textWords - Word boxes from Tesseract
 * @returns {string}
 */
export function mergeTextAndFormulas(textOCR, formulas, textWords) {
  if (!textWords || textWords.length === 0) {
    let result = textOCR;
    if (formulas && formulas.length > 0) {
      result += "\n\n" + formulas.map(f => f.placeholder).join("\n");
    }
    return result;
  }

  // 1. Identify words that overlap with any formula bounding box
  const nonFormulaWords = [];
  for (const word of textWords) {
    let overlaps = false;
    for (const f of formulas) {
      if (isOverlapping(word.bbox, f.bbox)) {
        overlaps = true;
        break;
      }
    }
    if (!overlaps) {
      nonFormulaWords.push(word);
    }
  }

  // 2. Prepare items list containing non-formula words and formula placeholders
  const items = [
    ...nonFormulaWords.map(w => ({ text: w.text, bbox: w.bbox })),
    ...formulas.map(f => ({ placeholder: f.placeholder, bbox: f.bbox }))
  ];

  if (items.length === 0) return "";

  // 3. Group items into lines based on vertical overlap
  const lineInfos = items.map(getItemLineInfo);
  lineInfos.sort((a, b) => a.yCenter - b.yCenter);

  const lines = []; // array of { y0, y1, items: [] }
  for (const info of lineInfos) {
    let placed = false;
    for (const line of lines) {
      const overlapY = Math.max(0, Math.min(info.y1, line.y1) - Math.max(info.y0, line.y0));
      const minH = Math.min(info.h, line.y1 - line.y0);
      if (minH > 0 && (overlapY / minH) > 0.45) {
        line.items.push(info);
        line.y0 = Math.min(line.y0, info.y0);
        line.y1 = Math.max(line.y1, info.y1);
        placed = true;
        break;
      }
    }
    if (!placed) {
      lines.push({
        y0: info.y0,
        y1: info.y1,
        items: [info]
      });
    }
  }

  // Sort lines by y0
  lines.sort((a, b) => a.y0 - b.y0);

  // 4. For each line, sort items by x0 and map to text/placeholder
  const lineTexts = lines.map(line => {
    line.items.sort((a, b) => a.x0 - b.x0);
    return line.items.map(info => {
      if (info.item.placeholder) {
        return info.item.placeholder;
      }
      return info.item.text;
    }).join(" ");
  });

  return lineTexts.join("\n");
}

/**
 * Replaces $$FORMULA_N$$ placeholders with actual wrapped LaTeX string.
 *
 * @param {string} mergedText
 * @param {Array<{ latex: string, placeholder: string }>} formulas
 * @returns {string}
 */
export function expandFormulasForPrompt(mergedText, formulas) {
  let result = String(mergedText || "");
  if (!formulas) return result;
  
  for (const f of formulas) {
    const wrapped = `\\(${f.latex}\\)`;
    result = result.replaceAll(f.placeholder, wrapped);
  }
  return result;
}

/**
 * Validates LaTeX syntax (braces balance, brackets balance).
 *
 * @param {string} latex
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateLatexSyntax(latex) {
  const errors = [];
  const str = String(latex || "");

  // Balanced curly braces
  let braces = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '{' && (i === 0 || str[i - 1] !== '\\')) {
      braces++;
    } else if (str[i] === '}' && (i === 0 || str[i - 1] !== '\\')) {
      braces--;
      if (braces < 0) {
        errors.push("Unbalanced closing brace '}'");
      }
    }
  }
  if (braces > 0) {
    errors.push("Unbalanced opening brace '{'");
  }

  // Balanced brackets
  let brackets = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '[' && (i === 0 || str[i - 1] !== '\\')) {
      brackets++;
    } else if (str[i] === ']' && (i === 0 || str[i - 1] !== '\\')) {
      brackets--;
      if (brackets < 0) {
        errors.push("Unbalanced closing bracket ']'");
      }
    }
  }
  if (brackets > 0) {
    errors.push("Unbalanced opening bracket '['");
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Standardizes LaTeX output from OCR models.
 *
 * @param {string} rawLatex
 * @returns {string}
 */
export function normalizeFormulaLatex(rawLatex) {
  let latex = String(rawLatex || "").trim();

  // Remove outermost wrappers: $$, $, \[, \], \(, \)
  if (latex.startsWith("$$") && latex.endsWith("$$")) {
    latex = latex.substring(2, latex.length - 2).trim();
  } else if (latex.startsWith("$") && latex.endsWith("$")) {
    latex = latex.substring(1, latex.length - 1).trim();
  } else if (latex.startsWith("\\[") && latex.endsWith("\\]")) {
    latex = latex.substring(2, latex.length - 2).trim();
  } else if (latex.startsWith("\\(") && latex.endsWith("\\)")) {
    latex = latex.substring(2, latex.length - 2).trim();
  }

  // Common Tesseract / Math OCR conversions: \sqrt2 -> \sqrt{2}
  latex = latex.replace(/\\sqrt(\d)/g, '\\sqrt{$1}');

  return latex.trim();
}

/**
 * Calculates formula confidence score.
 *
 * @param {string} latex
 * @param {number} modelConfidence
 * @returns {number}
 */
export function calculateFormulaConfidence(latex, modelConfidence) {
  let score = typeof modelConfidence === 'number' ? modelConfidence : 0;
  if (score > 0 && score <= 1) {
    score = score * 100;
  }
  score = Math.max(0, Math.min(100, score));

  const syntax = validateLatexSyntax(latex);
  if (!syntax.valid) {
    score = Math.min(score, 40) - 20;
  }

  if (!latex || latex.trim().length === 0) {
    score = 0;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Protects formula placeholders during OCR text normalization.
 */
export function protectFormulaPlaceholders(text) {
  const tokens = [];
  const exactRegex = /\$\$FORMULA_\d+\$\$/g;
  const protectedText = String(text || "").replace(exactRegex, (match) => {
    const tempToken = `__FORMULA_PLACEHOLDER_${tokens.length}__`;
    tokens.push({ token: tempToken, original: match });
    return tempToken;
  });
  return { protected: protectedText, tokens };
}

/**
 * Restores formula placeholders in normalized OCR text.
 */
export function restoreFormulaPlaceholders(text, tokens) {
  let restored = String(text || "");
  if (!tokens) return restored;
  for (let i = tokens.length - 1; i >= 0; i--) {
    restored = restored.replace(tokens[i].token, () => tokens[i].original);
  }
  return restored;
}
