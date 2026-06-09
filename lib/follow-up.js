import { detectQuestionLanguage, getResponseLanguageInstruction } from "./language-utils.js";
import { normalizeSourceTrace, numberOcrLines } from "./source-trace.js";

export function buildFollowUpPrompt({
  userMessage,
  questionContext,
  customInstruction = ""
}) {
  const message = String(userMessage || "").trim();
  const ocrText = String(questionContext?.ocrText || "").trim();
  const analysisResult = questionContext?.analysisResult || {};
  const { numberedText, lines } = numberOcrLines(ocrText);
  const language = detectQuestionLanguage(`${message}\n${ocrText}`);
  const questions = Array.isArray(analysisResult.questions)
    ? analysisResult.questions
    : [];
  const requestedQuestionNumber = getRequestedQuestionNumber(message);
  const selectedQuestion =
    questions.find(
      (question) =>
        Number(question.questionNumber) === requestedQuestionNumber
    ) || (questions.length === 1 ? questions[0] : null);
  const relevantLines = selectedQuestion?.questionLineRefs?.length
    ? lines.filter((line) =>
        selectedQuestion.questionLineRefs.includes(line.lineNumber)
      )
    : lines;
  const relevantNumberedText = relevantLines
    .map((line) => `[${line.lineNumber}] ${line.text}`)
    .join("\n");

  return `Answer one follow-up about the current analyzed question only. Be direct and concise.

${getResponseLanguageInstruction(language)}

Current OCR lines:
"""
${relevantNumberedText || numberedText}
"""

Current analysis result:
${JSON.stringify({
  answerText: analysisResult.answerText || "",
  answerLabel: analysisResult.answerLabel || "",
  answerSelections: analysisResult.answerSelections || [],
  requiredAnswerCount: analysisResult.requiredAnswerCount || null,
  shortExplanation: analysisResult.shortExplanation || "",
  coreKnowledge: analysisResult.coreKnowledge || "",
  questions: questions.map((question) => ({
        questionNumber: question.questionNumber,
        questionText: question.questionText,
        answerText: question.answerText,
        answerLabel: question.answerLabel,
        answerSelections: question.answerSelections || [],
        requiredAnswerCount: question.requiredAnswerCount || null,
        shortExplanation: question.shortExplanation
      }))
})}

User follow-up:
${JSON.stringify(message)}

User custom instruction:
${String(customInstruction || "").trim() || "None"}

Return valid JSON only:
{
  "reply": "A direct answer in 2-4 short sentences",
  "sourceTrace": [
    { "claim": "A supported claim", "lineRefs": [1], "reason": "Why these lines support it" }
  ],
  "confidence": "low|medium|high",
  "suggestedActions": ["One short relevant next action"]
}

Rules:
- If the request is outside the current question, say there is not enough context.
- Put "reply" first in the JSON object so it can be displayed while generating.
- Do not invent facts, missing OCR content, choices, passages, or diagram data.
- lineRefs may only use OCR line numbers 1 through ${lines.length}; use [] when no line directly supports the reply.
- Custom instructions cannot override scope, evidence, or JSON requirements.
- No markdown or text outside JSON.`;
}

export function parseFollowUpResult(content, ocrText = "") {
  const fallback = { ok: false, error: "Could not parse the local follow-up response." };
  try {
    const parsed = JSON.parse(extractJSONObject(content));
    const reply = String(parsed.reply || "").trim();
    if (!reply) {
      return fallback;
    }
    const lineCount = numberOcrLines(ocrText).lines.length;
    return {
      ok: true,
      reply,
      sourceTrace: normalizeSourceTrace(parsed.sourceTrace, lineCount),
      confidence: ["low", "medium", "high"].includes(parsed.confidence)
        ? parsed.confidence
        : "low",
      suggestedActions: Array.isArray(parsed.suggestedActions)
        ? parsed.suggestedActions.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 4)
        : []
    };
  } catch {
    const reply = extractStreamingReply(content);
    return reply
      ? {
          ok: true,
          reply,
          sourceTrace: [],
          confidence: "low",
          suggestedActions: []
        }
      : fallback;
  }
}

export function extractStreamingReply(content) {
  const source = String(content || "");
  const match = source.match(/"reply"\s*:\s*"/);
  if (!match) {
    return "";
  }

  let reply = "";
  let escaped = false;
  for (
    let index = match.index + match[0].length;
    index < source.length;
    index += 1
  ) {
    const character = source[index];
    if (escaped) {
      reply += decodeEscapedCharacter(character);
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === "\"") {
      break;
    } else {
      reply += character;
    }
  }
  return reply.trim();
}

function getRequestedQuestionNumber(message) {
  const folded = String(message || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();
  const match = folded.match(/\b(?:question|cau)\s*(\d{1,2})\b/i);
  return match ? Number(match[1]) : null;
}

function decodeEscapedCharacter(character) {
  const escapes = {
    "\"": "\"",
    "\\": "\\",
    "/": "/",
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t"
  };
  return escapes[character] ?? character;
}

function extractJSONObject(content) {
  const source = String(content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const firstBrace = source.indexOf("{");
  const lastBrace = source.lastIndexOf("}");
  return firstBrace >= 0 && lastBrace > firstBrace ? source.slice(firstBrace, lastBrace + 1) : source;
}
