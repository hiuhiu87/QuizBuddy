const NUMBERED_QUESTION_PATTERN =
  /^(?:question|c[ao]u|frage|aufgabe)?\s*[^a-z0-9\s]{0,3}\s*(\d{1,2})\s*[.):\-]\s*(.*)$/i;

export function estimateQuestionCount(text) {
  const lines = String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const numberedStarts = getNumberedQuestionStarts(lines);
  const starts = includeMissingFirstQuestionMarker(lines, numberedStarts);

  if (starts.length >= 2) {
    return Math.min(10, starts.length);
  }

  const questionLines = lines.filter(
    (line) =>
      /[?？]\s*$/u.test(line) &&
      !/^[A-D]\s*[.):\-]/i.test(line)
  ).length;
  return Math.max(1, Math.min(10, questionLines || 1));
}

export function detectRequiredAnswerCount(text) {
  const folded = String(text || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();
  const numericMatch = folded.match(
    /(?:chon|choose|select|pick|wahle|wahlen)\s*(?:dap an\s*)?(\d{1,2})\b/i
  );
  if (numericMatch) {
    return clampAnswerCount(numericMatch[1]);
  }

  const numberWords = {
    hai: 2,
    two: 2,
    ba: 3,
    three: 3,
    drei: 3,
    bon: 4,
    four: 4,
    vier: 4,
    nam: 5,
    five: 5,
    funf: 5
  };
  const wordMatch = folded.match(
    /(?:chon|choose|select|pick|wahle|wahlen)\s*(?:dap an\s*)?(hai|two|ba|three|drei|bon|four|vier|nam|five|funf)\b/i
  );
  return wordMatch ? numberWords[wordMatch[1]] : null;
}

export function normalizeQuestionLineRefs(value, lineCount) {
  const maximumLine = Math.max(0, Number(lineCount) || 0);
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(
      value
        .map(Number)
        .filter(
          (line) =>
            Number.isInteger(line) && line >= 1 && line <= maximumLine
        )
    )
  ].sort((a, b) => a - b);
}

export function getQuestionScopeText(lines, lineRefs, fallbackText = "") {
  if (!lineRefs.length) {
    return String(fallbackText || "");
  }
  const lineByNumber = new Map(
    lines.map((line) => [line.lineNumber, line.text])
  );
  return lineRefs
    .map((lineNumber) => lineByNumber.get(lineNumber))
    .filter(Boolean)
    .join("\n");
}

export function inferQuestionLineScopes(text) {
  const lines = String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text, index) => ({
      lineNumber: index + 1,
      text
    }));
  const numberedStarts = getNumberedQuestionStarts(
    lines.map((line) => line.text)
  );
  const starts = includeMissingFirstQuestionMarker(
    lines.map((line) => line.text),
    numberedStarts
  );

  if (starts.length < 2) {
    starts.length = 0;
    lines.forEach((line, index) => {
      if (
        /[?？]\s*$/u.test(line.text) &&
        !/^(?:[A-Z]|\d{1,2})\s*[.):\-]/i.test(line.text)
      ) {
        starts.push(index);
      }
    });
  }

  if (starts.length < 2) {
    return lines.length
      ? [lines.map((line) => line.lineNumber)]
      : [];
  }

  return starts.map((start, index) => {
    const end = starts[index + 1] ?? lines.length;
    return lines.slice(start, end).map((line) => line.lineNumber);
  });
}

export function remapQuestionToSourceScope(question, sourceLineRefs) {
  const scope = Array.isArray(sourceLineRefs) ? sourceLineRefs : [];
  const remap = (lineRefs) =>
    normalizeQuestionLineRefs(lineRefs, scope.length)
      .map((lineNumber) => scope[lineNumber - 1])
      .filter(Number.isInteger);

  return {
    ...question,
    questionLineRefs:
      remap(question?.questionLineRefs).length > 0
        ? remap(question.questionLineRefs)
        : [...scope],
    sourceTrace: Array.isArray(question?.sourceTrace)
      ? question.sourceTrace.map((trace) => ({
          ...trace,
          lineRefs: remap(trace?.lineRefs)
        }))
      : []
  };
}

export function chunkQuestionScopes(scopes, chunkSize = 4) {
  const normalizedSize = Math.max(1, Number(chunkSize) || 1);
  const chunks = [];
  for (let index = 0; index < scopes.length; index += normalizedSize) {
    chunks.push(scopes.slice(index, index + normalizedSize));
  }
  return chunks;
}

function isNumberedQuestionStart(line) {
  return getQuestionNumber(line) !== null;
}

function getQuestionNumber(line) {
  const folded = String(line || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();
  const match = folded.match(NUMBERED_QUESTION_PATTERN);
  return match ? Number(match[1]) : null;
}

function getNumberedQuestionStarts(lines) {
  return lines.flatMap((line, index) => {
    const questionNumber = getQuestionNumber(line);
    return questionNumber === null
      ? []
      : [{ index, questionNumber }];
  });
}

function includeMissingFirstQuestionMarker(lines, numberedStarts) {
  const starts = numberedStarts.map((item) => item.index);
  const firstNumbered = numberedStarts[0];
  if (!firstNumbered || firstNumbered.questionNumber <= 1) {
    return starts;
  }

  for (let index = firstNumbered.index - 1; index >= 0; index -= 1) {
    if (isStandaloneQuestionMarker(lines[index])) {
      starts.unshift(index);
      break;
    }
  }
  return starts;
}

function isStandaloneQuestionMarker(line) {
  const folded = String(line || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .trim();
  return /^(?:question|c[ao]u|frage|aufgabe)\s*[.!:;\-]*$/i.test(
    folded
  );
}

function clampAnswerCount(value) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 2 && count <= 10
    ? count
    : null;
}
