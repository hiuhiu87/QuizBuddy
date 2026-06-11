/**
 * Local Math & Formula OCR — Formula Rendering Module
 * Wraps KaTeX to render LaTeX formulas safely for Shadow DOM.
 */

import katex from "katex";

/**
 * Checks if a string contains LaTeX inline or block markers.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function containsLatexMarkers(text) {
  const str = String(text || "");
  return str.includes("\\(") || str.includes("\\[");
}

/**
 * Renders a LaTeX formula to an HTML Element using KaTeX.
 *
 * @param {string} latex
 * @param {boolean} [displayMode=false]
 * @returns {HTMLElement}
 */
export function renderFormulaElement(latex, displayMode = false) {
  if (typeof document === "undefined") {
    // Mock DOM structure for non-browser/test environment
    return {
      tagName: "SPAN",
      className: displayMode
        ? "qb-formula qb-formula-block qb-formula-entering"
        : "qb-formula qb-formula-inline qb-formula-entering",
      textContent: displayMode ? `\\[${latex}\\]` : `\\(${latex}\\)`,
      isMock: true,
      hasBadge: displayMode
    };
  }

  const container = document.createElement("span");
  container.className = displayMode
    ? "qb-formula qb-formula-block qb-formula-entering"
    : "qb-formula qb-formula-inline qb-formula-entering";

  try {
    container.innerHTML = katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false,
      output: "html"
    });
  } catch {
    container.textContent = displayMode ? `\\[${latex}\\]` : `\\(${latex}\\)`;
    container.classList.add("qb-formula-fallback");
  }

  if (displayMode) {
    const badge = document.createElement("span");
    badge.className = "qb-formula-badge";
    badge.textContent = "LaTeX ✓";
    container.appendChild(badge);
  }

  return container;
}

/**
 * Tokenizes text containing LaTeX formula markers.
 *
 * @param {string} text
 * @returns {Array<{ type: "text" | "formula", content: string, displayMode?: boolean }>}
 */
export function parseTextWithFormulas(text) {
  const str = String(text || "");
  const tokens = [];
  let pos = 0;

  while (pos < str.length) {
    const nextInlineOpen = str.indexOf("\\(", pos);
    const nextBlockOpen = str.indexOf("\\[", pos);

    let openIndex = -1;
    let type = null;
    let closeMarker = "";

    if (nextInlineOpen !== -1 && (nextBlockOpen === -1 || nextInlineOpen < nextBlockOpen)) {
      openIndex = nextInlineOpen;
      type = "inline";
      closeMarker = "\\)";
    } else if (nextBlockOpen !== -1) {
      openIndex = nextBlockOpen;
      type = "block";
      closeMarker = "\\]";
    }

    if (openIndex === -1) {
      const remainder = str.substring(pos);
      if (remainder) {
        tokens.push({ type: "text", content: remainder });
      }
      break;
    }

    if (openIndex > pos) {
      tokens.push({ type: "text", content: str.substring(pos, openIndex) });
    }

    const closeIndex = str.indexOf(closeMarker, openIndex + 2);
    if (closeIndex === -1) {
      tokens.push({ type: "text", content: str.substring(openIndex) });
      break;
    }

    const formulaContent = str.substring(openIndex + 2, closeIndex);
    tokens.push({
      type: "formula",
      content: formulaContent,
      displayMode: type === "block"
    });

    pos = closeIndex + 2;
  }

  return tokens;
}

/**
 * Renders text containing LaTeX markers into a DOM DocumentFragment.
 *
 * @param {string} text
 * @returns {DocumentFragment | object}
 */
export function renderTextWithFormulas(text) {
  if (typeof document === "undefined") {
    // Mock fragment structure for non-browser/test environment
    const fragment = {
      childNodes: [],
      appendChild(node) {
        this.childNodes.push(node);
      }
    };
    const tokens = parseTextWithFormulas(text);
    for (const t of tokens) {
      if (t.type === "formula") {
        fragment.appendChild({
          tagName: "SPAN",
          className: t.displayMode
            ? "qb-formula qb-formula-block qb-formula-entering"
            : "qb-formula qb-formula-inline qb-formula-entering",
          textContent: t.content,
          isFormula: true,
          hasBadge: t.displayMode
        });
      } else {
        fragment.appendChild({
          tagName: "TEXT",
          textContent: t.content
        });
      }
    }
    return fragment;
  }

  const fragment = document.createDocumentFragment();
  const tokens = parseTextWithFormulas(text);
  for (const t of tokens) {
    if (t.type === "formula") {
      fragment.appendChild(renderFormulaElement(t.content, t.displayMode));
    } else {
      fragment.appendChild(document.createTextNode(t.content));
    }
  }
  return fragment;
}

/**
 * Builds CSS @font-face rules for KaTeX fonts.
 *
 * @returns {string}
 */
export function buildKaTeXFontFaceCSS() {
  const fontNames = [
    { name: "KaTeX_AMS-Regular", file: "KaTeX_AMS-Regular" },
    { name: "KaTeX_Caligraphic-Bold", file: "KaTeX_Caligraphic-Bold" },
    { name: "KaTeX_Caligraphic-Regular", file: "KaTeX_Caligraphic-Regular" },
    { name: "KaTeX_Fraktur-Bold", file: "KaTeX_Fraktur-Bold" },
    { name: "KaTeX_Fraktur-Regular", file: "KaTeX_Fraktur-Regular" },
    { name: "KaTeX_Main-Bold", file: "KaTeX_Main-Bold" },
    { name: "KaTeX_Main-BoldItalic", file: "KaTeX_Main-BoldItalic" },
    { name: "KaTeX_Main-Italic", file: "KaTeX_Main-Italic" },
    { name: "KaTeX_Main-Regular", file: "KaTeX_Main-Regular" },
    { name: "KaTeX_Math-BoldItalic", file: "KaTeX_Math-BoldItalic" },
    { name: "KaTeX_Math-Italic", file: "KaTeX_Math-Italic" },
    { name: "KaTeX_SansSerif-Bold", file: "KaTeX_SansSerif-Bold" },
    { name: "KaTeX_SansSerif-Italic", file: "KaTeX_SansSerif-Italic" },
    { name: "KaTeX_SansSerif-Regular", file: "KaTeX_SansSerif-Regular" },
    { name: "KaTeX_Script-Regular", file: "KaTeX_Script-Regular" },
    { name: "KaTeX_Size1-Regular", file: "KaTeX_Size1-Regular" },
    { name: "KaTeX_Size2-Regular", file: "KaTeX_Size2-Regular" },
    { name: "KaTeX_Size3-Regular", file: "KaTeX_Size3-Regular" },
    { name: "KaTeX_Size4-Regular", file: "KaTeX_Size4-Regular" },
    { name: "KaTeX_Typewriter-Regular", file: "KaTeX_Typewriter-Regular" }
  ];

  let css = "";
  for (const font of fontNames) {
    const url = typeof chrome !== "undefined" && chrome.runtime
      ? chrome.runtime.getURL(`vendor/katex/fonts/${font.file}.woff2`)
      : `../vendor/katex/fonts/${font.file}.woff2`;

    css += `
@font-face {
  font-family: '${font.name}';
  src: url('${url}') format('woff2');
  font-weight: normal;
  font-style: normal;
}
`;
  }
  return css;
}
