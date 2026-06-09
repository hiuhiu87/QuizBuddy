export function numberOcrLines(text) {
  const lines = String(text || "")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({
      lineNumber: index + 1,
      text: line
    }));

  return {
    numberedText: lines
      .map((line) => `[${line.lineNumber}] ${line.text}`)
      .join("\n"),
    lines
  };
}

export function normalizeSourceTrace(value, lineCount) {
  if (!Array.isArray(value)) {
    return [];
  }

  const maximumLine = Math.max(0, Number(lineCount) || 0);
  return value
    .map((item) => {
      const claim = cleanField(item?.claim);
      const reason = cleanField(item?.reason);
      const lineRefs = Array.isArray(item?.lineRefs)
        ? [
            ...new Set(
              item.lineRefs
                .map(Number)
                .filter(
                  (line) =>
                    Number.isInteger(line) &&
                    line >= 1 &&
                    line <= maximumLine
                )
            )
          ]
        : [];

      if (!claim && !reason) {
        return null;
      }

      return { claim, lineRefs, reason };
    })
    .filter(Boolean)
    .slice(0, 8);
}

function cleanField(value) {
  return String(value || "").trim();
}
