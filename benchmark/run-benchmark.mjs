import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAnalysisPrompt } from "../lib/analysis-prompt.js";
import { parseAIResult } from "../lib/processing-utils.js";
import { numberOcrLines } from "../lib/source-trace.js";

const benchmarkRoot = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(
  benchmarkRoot,
  "fixtures",
  "questions.json"
);
const fixtures = JSON.parse(await readFile(fixturePath, "utf8"));
const resultsPath = getArgumentValue("--results");
const storedResults = resultsPath
  ? JSON.parse(await readFile(path.resolve(resultsPath), "utf8"))
  : [];
const resultById = new Map(
  storedResults.map((result) => [result.id, result])
);

const failedCases = [];
let answerMatchCount = 0;
let conceptKeywordMatchCount = 0;

for (const fixture of fixtures) {
  const prompt = buildAnalysisPrompt(fixture.ocrText, {
    mode: "learning",
    subject: fixture.subject
  });
  const numberedText = numberOcrLines(fixture.ocrText).numberedText;
  if (!prompt.includes(numberedText) || !prompt.includes("valid JSON")) {
    failedCases.push({
      id: fixture.id,
      reason: "Prompt regression"
    });
    continue;
  }

  const storedResult = resultById.get(fixture.id);
  if (!storedResult) {
    continue;
  }

  const parsed = parseAIResult(
    storedResult.content,
    fixture.ocrText,
    { requestedMode: "learning" }
  );
  const answerMatches = normalize(parsed.answerText).includes(
    normalize(fixture.expectedAnswerText)
  );
  const conceptMatches = fixture.expectedCoreConceptKeywords.every(
    (keyword) =>
      normalize(parsed.coreKnowledge).includes(normalize(keyword))
  );

  answerMatchCount += Number(answerMatches);
  conceptKeywordMatchCount += Number(conceptMatches);
  if (!answerMatches || !conceptMatches) {
    failedCases.push({
      id: fixture.id,
      reason: [
        answerMatches ? "" : "answer mismatch",
        conceptMatches ? "" : "concept mismatch"
      ]
        .filter(Boolean)
        .join(", ")
    });
  }
}

const summary = {
  totalCases: fixtures.length,
  evaluatedResults: storedResults.length,
  answerMatchCount,
  conceptKeywordMatchCount,
  failedCases
};

console.log(JSON.stringify(summary, null, 2));
if (failedCases.some((failure) => failure.reason === "Prompt regression")) {
  process.exitCode = 1;
}

function getArgumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function normalize(value) {
  return String(value || "")
    .normalize("NFC")
    .toLocaleLowerCase()
    .replace(/[.,;:!?()[\]{}"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
