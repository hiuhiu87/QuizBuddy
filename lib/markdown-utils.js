export function parseMarkdownBlocks(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^\s*```([\w+-]*)\s*$/);
    if (fence) {
      const code = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", language: fence[1], text: code.join("\n") });
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length,
        text: heading[2]
      });
      index += 1;
      continue;
    }

    if (/^\s{0,3}(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }

    if (/^\s{0,3}>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s{0,3}>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s{0,3}>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "quote", children: parseMarkdownBlocks(quote.join("\n")) });
      continue;
    }

    const listMatch = line.match(/^(\s*)([-+*]|\d+[.)])\s+(.+)$/);
    if (listMatch) {
      const ordered = /^\d/.test(listMatch[2]);
      const items = [];
      while (index < lines.length) {
        const match = lines[index].match(/^(\s*)([-+*]|\d+[.)])\s+(.+)$/);
        if (!match || /^\d/.test(match[2]) !== ordered) break;
        items.push(match[3]);
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    if (isTableHeader(lines, index)) {
      const headers = splitTableRow(lines[index]);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes("|")) {
        const row = splitTableRow(lines[index]);
        if (!row.length) break;
        rows.push(row);
        index += 1;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !startsBlock(lines, index)
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraph.join("\n") });
  }

  return blocks;
}

export function parseMarkdownInline(text) {
  const source = String(text || "");
  const tokens = [];
  const pattern =
    /(`[^`\n]+`)|(\[([^\]\n]+)\]\(([^)\s]+)\))|(\*\*([^*\n]+)\*\*)|(__([^_\n]+)__)|(\*([^*\n]+)\*)|(_([^_\n]+)_)/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(source))) {
    if (match.index > lastIndex) {
      tokens.push({ type: "text", text: source.slice(lastIndex, match.index) });
    }
    if (match[1]) {
      tokens.push({ type: "code", text: match[1].slice(1, -1) });
    } else if (match[2]) {
      tokens.push({
        type: "link",
        text: match[3],
        href: normalizeMarkdownUrl(match[4])
      });
    } else if (match[5] || match[7]) {
      tokens.push({ type: "strong", text: match[6] || match[8] });
    } else {
      tokens.push({ type: "emphasis", text: match[10] || match[12] });
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < source.length) {
    tokens.push({ type: "text", text: source.slice(lastIndex) });
  }
  return tokens;
}

export function normalizeMarkdownUrl(value) {
  const source = String(value || "").trim();
  try {
    const url = new URL(source);
    return ["http:", "https:", "mailto:"].includes(url.protocol)
      ? url.href
      : "";
  } catch {
    return "";
  }
}

function startsBlock(lines, index) {
  const line = lines[index];
  return (
    /^\s*```/.test(line) ||
    /^\s{0,3}#{1,6}\s+/.test(line) ||
    /^\s{0,3}>/.test(line) ||
    /^(\s*)([-+*]|\d+[.)])\s+/.test(line) ||
    /^\s{0,3}(?:---+|\*\*\*+|___+)\s*$/.test(line) ||
    isTableHeader(lines, index)
  );
}

function isTableHeader(lines, index) {
  if (!lines[index]?.includes("|") || !lines[index + 1]) return false;
  const separator = splitTableRow(lines[index + 1]);
  return (
    separator.length > 0 &&
    separator.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
  );
}

function splitTableRow(line) {
  return String(line || "")
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}
