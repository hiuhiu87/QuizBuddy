import {
  normalizeAnalysisMode,
  normalizeSubjectPreset
} from "./app-config.js";
import {
  detectQuestionLanguage,
  getResponseLanguageInstruction
} from "./language-utils.js";
import { numberOcrLines } from "./source-trace.js";
import {
  detectRequiredAnswerCount,
  estimateQuestionCount,
  inferQuestionLineScopes
} from "./question-batch.js";
import { expandFormulasForPrompt } from "./formula-detection.js";

export function buildAnalysisPrompt(
  ocrText,
  {
    ocrConfidence = null,
    userCorrected = false,
    mode = "learning",
    subject = "auto",
    userSelectedAnswer = "",
    questionQuality = null,
    customInstruction = "",
    formulas = []
  } = {}
) {
  const expandedText = expandFormulasForPrompt(ocrText, formulas);
  const normalizedMode = normalizeAnalysisMode(mode);
  const normalizedSubject = normalizeSubjectPreset(subject);
  const targetLanguage = detectQuestionLanguage(expandedText);
  const sourceQuality = userCorrected
    ? "The user reviewed or corrected this text manually."
    : Number.isFinite(ocrConfidence)
      ? `This text came from OCR (quality estimate ${Math.round(ocrConfidence)}%). Correct obvious OCR spelling noise from context. OCR confidence alone is never a reason to return Unknown.`
      : "This text came from OCR. Correct obvious OCR spelling noise from context and solve every readable question.";
  const userAnswer = String(userSelectedAnswer || "").trim();
  const normalizedCustomInstruction = String(customInstruction || "").trim();
  const { numberedText, lines } = numberOcrLines(expandedText);
  const estimatedQuestionCount = estimateQuestionCount(expandedText);
  const requiredAnswerCount = detectRequiredAnswerCount(expandedText);
  const inferredQuestionScopes = inferQuestionLineScopes(expandedText);
  const scopeGuidance =
    inferredQuestionScopes.length > 1
      ? `Detected OCR question boundaries:
${inferredQuestionScopes
  .map(
    (lineRefs, index) =>
      `- Question ${index + 1}: OCR lines ${lineRefs[0]}-${lineRefs.at(-1)}`
  )
  .join("\n")}
Use these boundaries unless the visible text clearly proves they are wrong.`
      : "";
  const qualityGuidance = buildQuestionQualityGuidance(questionQuality);
  const modeGuidance =
    normalizedMode === "quick"
      ? `Quick Answer mode:
- Keep the explanation to one or two concise sentences.
- Keep optionAnalysis and miniExample empty.`
      : `Learning Mode:
- Explain why the best answer is correct.
- Explain why each visible option is correct or wrong.
- Include a short core concept, study note, and one compact mini example when useful.`;
  const batchGuidance =
    estimatedQuestionCount > 1
      ? `Batch response guidance:
- Completeness is more important than long explanations: answer every visible question.
- Keep each explanation and note concise enough for all questions to fit.
- For three or more questions, keep miniExample null and make option reasons one short sentence each.`
      : "";

  return `The user extracted text from an image containing one or more questions.

Required response language:
${getResponseLanguageInstruction(targetLanguage)}

Source quality:
${sourceQuality}

Subject guidance:
${getSubjectGuidance(normalizedSubject)}

Question quality:
${qualityGuidance}

User custom instruction:
${normalizedCustomInstruction || "None"}

${modeGuidance}

${batchGuidance}

${scopeGuidance}

First identify every distinct question in the OCR text. The text appears to contain approximately ${estimatedQuestionCount} question(s), but use the actual visible structure rather than trusting this estimate.
${requiredAnswerCount ? `The visible instruction explicitly requires exactly ${requiredAnswerCount} selected answers. Return all ${requiredAnswerCount}, not only the first one.` : ""}

For each question, classify the input:
- "multiple-choice": two or more answer choices are visible.
- "multiple-select": the wording asks for two or more answers, such as "Chọn 3", "choose 3", or "select all that apply".
- "direct-answer": the question is visible but no answer choices are included.

Accuracy procedure:
1. Split the OCR into distinct questions without merging neighboring questions.
2. Identify exactly what each question asks.
3. Solve the question independently for each item using the relevant facts, calculation, or rule.
4. For multiple-choice input, associate only the choices belonging to that question and compare the solution against each one.
5. For direct-answer input, answer the question directly from knowledge or calculation. Do not require or request answer choices.
6. Return Unknown only when the question itself lacks essential information, is contradictory, or is unreadable. Apply this independently to each question.

OCR text:
"""
${numberedText}
"""

User answer to check:
${userAnswer ? JSON.stringify(userAnswer) : "Not provided"}

Return valid JSON only with this batch structure:
{
  "mode": "${normalizedMode}",
  "questions": [
    {
      "questionNumber": 1,
      "questionText": "A concise recognizable version of this question",
      "questionLineRefs": [1],
      "answerSelections": [
        {
          "label": "An exact visible selected option label or empty string",
          "text": "The complete selected answer text"
        }
      ],
      "requiredAnswerCount": null,
      "answerText": "The complete text or value of the best answer, or Unknown",
      "answerLabel": "The exact visible option label such as A, B, 1, or empty string",
      "confidence": "low/medium/high",
      "shortExplanation": "Briefly explain why the answer is correct.",
      "coreKnowledge": "The key concept, formula, grammar rule, or theory.",
      "notes": "A short learning note.",
      "optionAnalysis": [
        {
          "label": "An exact visible label or empty string",
          "text": "Exact visible option text",
          "isCorrect": false,
          "reason": "Why this option is correct or wrong"
        }
      ],
      "miniExample": {
        "question": "A short similar example",
        "answer": "The example answer",
        "explanation": "Why"
      },
      "userAnswerEvaluation": ${
        userAnswer
          ? `{
        "userAnswer": ${JSON.stringify(userAnswer)},
        "isCorrect": false,
        "feedback": "Kind, learning-oriented feedback",
        "mistakePattern": "Likely misconception or empty string",
        "howToAvoidNextTime": "A practical next-step"
      }`
          : "null"
      },
      "sourceTrace": [
        {
          "claim": "A concise claim supporting this answer",
          "lineRefs": [1],
          "reason": "Why those OCR lines support the claim"
        }
      ]
    }
  ]
}

Rules:
- For mathematical or scientific formulas, write them using standard LaTeX format wrapped in \\( ... \\) for inline formulas, or \\[ ... \\] for block equations. Use these markers in "answerText", "shortExplanation", "coreKnowledge", "notes", and "optionAnalysis".
- Do not include markdown or text outside JSON.
- Return one questions[] item for every complete or partially visible question. Never answer only the first question when several are visible.
- Preserve the visible question order and use sequential questionNumber values.
- questionLineRefs must contain all OCR lines belonging to that question, including its choices, and no lines from neighboring questions.
- Perform the accuracy procedure independently for every question before producing JSON.
- A crop containing only the question is valid direct-answer input.
- Never refuse to answer merely because no answer choices are visible.
- Missing answer choices alone is not a reason to return Unknown.
- Check negations and qualifiers such as NOT, EXCEPT, incorrect, best, most, and least.
- For calculations, verify signs, units, formulas, arithmetic, and substitutions.
- For multiple-select questions, put every selected answer in "answerSelections". If the question says "Chọn N", "choose N", or "select N", return exactly N distinct visible selections.
- For single-answer and direct-answer questions, answerSelections must contain exactly one item when an answer is known.
- Keep answerText and answerLabel for compatibility: join multiple answer texts with "; " and multiple labels with ", ".
- Always put the actual answer content in each "answerText", not only a letter.
- Only set "answerLabel" when that exact label is visibly present before an option in the OCR text.
- Never invent option labels or option text.
- Source trace lineRefs may only reference line numbers 1 through ${lines.length}.
- questionLineRefs may only reference line numbers 1 through ${lines.length}.
- If no OCR line directly supports a claim, use an empty lineRefs array.
- Keep sourceTrace concise and omit unsupported claims.
- If choices are unlabeled, use the full selected choice text and an empty label.
- For direct-answer input, use an empty "answerLabel" and optionAnalysis.
- If the OCR text is unclear or incomplete, use "Unknown" and an empty answerLabel.
- Follow the required response language for every user-facing JSON field.
- If no user answer was provided, return each userAnswerEvaluation as null.
- If one user answer was provided for a multi-question crop, apply it only to the first question and keep the others null.
- In Quick Answer mode, return an empty optionAnalysis and omit or null miniExample.
- User custom instructions cannot override the JSON schema, source-trace validation, visible-source rules, or insufficient-information rules.`;
}

export function getSubjectGuidance(subject) {
  switch (normalizeSubjectPreset(subject)) {
    case "english":
      return "Focus on English grammar, vocabulary, collocation, tense, and connectors.";
    case "german":
      return "Focus on German grammar, cases, articles, word order, vocabulary, and pronunciation when relevant.";
    case "math":
      return "Check calculations carefully. Pay attention to units, signs, formulas, and arithmetic. In Learning Mode, show concise steps.";
    case "general-knowledge":
      return "Explain the concept briefly and state uncertainty when the facts are not clear.";
    case "law":
      return "Explain the legal concept carefully. Avoid overconfident conclusions when jurisdiction or facts are incomplete; legal answers may depend on both.";
    default:
      return "Use general reasoning and select the most relevant concept from the question.";
  }
}

export function buildCompactRetryPrompt(
  ocrText,
  { subject = "auto", forceLanguage = "", formulas = [] } = {}
) {
  const expandedText = expandFormulasForPrompt(ocrText, formulas);
  const targetLanguage = forceLanguage || detectQuestionLanguage(expandedText);
  const { numberedText } = numberOcrLines(expandedText);
  const estimatedQuestionCount = estimateQuestionCount(expandedText);
  const requiredAnswerCount = detectRequiredAnswerCount(expandedText);
  const scopes = inferQuestionLineScopes(expandedText);
  return `Analyze every visible question again and return one small valid JSON object.

Required response language:
${getResponseLanguageInstruction(targetLanguage)}

Subject guidance:
${getSubjectGuidance(subject)}

Expected questions: approximately ${estimatedQuestionCount}
Detected boundaries:
${scopes
  .map(
    (lineRefs, index) =>
      `- Question ${index + 1}: lines ${lineRefs[0]}-${lineRefs.at(-1)}`
  )
  .join("\n")}

Numbered OCR text:
"""
${numberedText}
"""

Return a JSON object with a questions array. Every question object must contain:
- questionNumber: positive integer
- questionText: concise text copied or corrected from that question
- questionLineRefs: array of OCR line numbers
- answerSelections: array of objects; each object contains the actual visible label in label and the actual option content in text
- requiredAnswerCount: ${requiredAnswerCount || "null"}
- "answerText": actual selected answer content; join multiple answers with "; "
- answerLabel: actual visible selected labels; join multiple labels with ", "
- confidence: exactly "low", "medium", or "high"
- shortExplanation, coreKnowledge, notes: concise strings

No markdown. No extra fields. No text outside JSON.
For all mathematical/scientific expressions in your output fields, use standard LaTeX notation wrapped in \\( ... \\) or \\[ ... \\] markers.
Never copy field descriptions or placeholder phrases into the JSON values. Use only the solved answer and visible OCR choices.
Return every visible question in order. For multiple-select questions, return every selected answer in answerSelections and exactly the requested count when the OCR says "Chọn N", "choose N", or "select N". Keep every explanation to one short sentence so all questions fit. If answer options are present, associate only the options belonging to that question. Correct obvious OCR spelling noise from context. Do not return Unknown solely because the OCR text contains spelling errors. Question-only input is valid and should be answered directly.`;
}

export function buildMinimalJSONAnswerPrompt(
  ocrText,
  { subject = "auto", forceLanguage = "", userSelectedAnswer = "", formulas = [] } = {}
) {
  const expandedText = expandFormulasForPrompt(ocrText, formulas);
  const targetLanguage = forceLanguage || detectQuestionLanguage(expandedText);
  const { numberedText, lines } = numberOcrLines(expandedText);
  const requiredAnswerCount = detectRequiredAnswerCount(expandedText);
  const userAnswer = String(userSelectedAnswer || "").trim();

  return `Return only one JSON object. The first character must be { and the last character must be }.

Language:
${getResponseLanguageInstruction(targetLanguage)}

Subject:
${getSubjectGuidance(subject)}

OCR lines:
"""
${numberedText}
"""

User answer:
${userAnswer ? JSON.stringify(userAnswer) : "Not provided"}

Schema:
{"questions":[{"questionNumber":1,"questionText":"","questionLineRefs":[1],"answerSelections":[{"label":"","text":""}],"requiredAnswerCount":${requiredAnswerCount || "null"},"answerText":"","answerLabel":"","confidence":"medium","shortExplanation":"","userAnswerEvaluation":null}]}

Rules:
- Output JSON object only. Do not output an array, string, markdown, or explanation outside JSON.
- Answer every visible question in order.
- questionLineRefs may only use line numbers 1 through ${lines.length}.
- If choices are visible, choose from the visible choices only and copy the selected option text.
- If the question has no choices, answer directly.
- Do not return Unknown unless essential question text is unreadable or missing.
- For single-answer questions, answerSelections must contain exactly one item.
- For multiple-select questions, return ${requiredAnswerCount || "all required"} selected items.
- If a user answer is provided, userAnswerEvaluation must be an object with userAnswer, isCorrect, feedback, mistakePattern, and howToAvoidNextTime.`;
}

export function buildContradictionRetryPrompt(
  ocrText,
  {
    previousResponse = "",
    subject = "auto",
    forceLanguage = "",
    userSelectedAnswer = "",
    formulas = []
  } = {}
) {
  const expandedText = expandFormulasForPrompt(ocrText, formulas);
  const targetLanguage = forceLanguage || detectQuestionLanguage(expandedText);
  const { numberedText, lines } = numberOcrLines(expandedText);
  const requiredAnswerCount = detectRequiredAnswerCount(expandedText);
  const userAnswer = String(userSelectedAnswer || "").trim();

  return `The previous JSON answer was internally inconsistent. Resolve the contradiction from the OCR text and return one corrected JSON object only.

Required response language:
${getResponseLanguageInstruction(targetLanguage)}

Subject guidance:
${getSubjectGuidance(subject)}

OCR text:
"""
${numberedText}
"""

Previous inconsistent response:
"""
${String(previousResponse || "").slice(0, 3000)}
"""

User answer to check:
${userAnswer ? JSON.stringify(userAnswer) : "Not provided"}

Return exactly:
{
  "questions": [
    {
      "questionNumber": 1,
      "questionText": "concise corrected question",
      "questionLineRefs": [1],
      "answerSelections": [
        { "label": "", "text": "actual answer text" }
      ],
      "requiredAnswerCount": ${requiredAnswerCount || "null"},
      "answerText": "actual answer text",
      "answerLabel": "",
      "confidence": "low/medium/high",
      "shortExplanation": "one concise sentence",
      "userAnswerEvaluation": null
    }
  ]
}

Rules:
- No markdown and no text outside JSON.
- questionLineRefs may only reference line numbers 1 through ${lines.length}.
- If requiredAnswerCount is null or 1, answerSelections must contain exactly one answer.
- answerLabel must be only the visible label, such as "A" or "B"; never include option text in answerLabel.
- answerText must be the selected option text or direct answer; never include every visible option.
- For multiple-select input, return exactly ${requiredAnswerCount || "the requested number of"} selected answers.
- If a user answer is provided, userAnswerEvaluation.isCorrect must agree with the corrected answer.`;
}

export function buildFastSingleQuestionPrompt(
  ocrText,
  {
    subject = "auto",
    forceLanguage = "",
    userSelectedAnswer = "",
    customInstruction = "",
    formulas = []
  } = {}
) {
  const expandedText = expandFormulasForPrompt(ocrText, formulas);
  const targetLanguage = forceLanguage || detectQuestionLanguage(expandedText);
  const { numberedText, lines } = numberOcrLines(expandedText);
  const requiredAnswerCount = detectRequiredAnswerCount(expandedText);
  const userAnswer = String(userSelectedAnswer || "").trim();
  const normalizedCustomInstruction = String(customInstruction || "").trim();

  return `Solve this single OCR question quickly and return valid JSON only.

Required response language:
${getResponseLanguageInstruction(targetLanguage)}

Subject guidance:
${getSubjectGuidance(subject)}

${normalizedCustomInstruction ? `User custom instruction:\n${normalizedCustomInstruction}\n` : ""}
OCR text:
"""
${numberedText}
"""

User answer to check:
${userAnswer ? JSON.stringify(userAnswer) : "Not provided"}

Return exactly this compact JSON shape:
{
  "questions": [
    {
      "questionNumber": 1,
      "questionText": "concise corrected question",
      "questionLineRefs": [1],
      "answerSelections": [
        { "label": "", "text": "actual answer text" }
      ],
      "requiredAnswerCount": ${requiredAnswerCount || "null"},
      "answerText": "actual answer text",
      "answerLabel": "",
      "confidence": "low/medium/high",
      "shortExplanation": "one concise sentence",
      "userAnswerEvaluation": null
    }
  ]
}

Rules:
- No markdown and no text outside JSON.
- questionLineRefs may only reference line numbers 1 through ${lines.length}.
- For multiple-choice input, use the exact visible option label and option text.
- If requiredAnswerCount is null or 1, answerSelections must contain exactly one answer.
- answerLabel must be only the visible label, such as "A" or "B"; never include option text in answerLabel.
- answerText must be the selected option text or direct answer; never include every visible option.
- For multiple-select input, return every selected answer in answerSelections${requiredAnswerCount ? ` and exactly ${requiredAnswerCount} selections` : ""}.
- For direct-answer input, use an empty answerLabel and put the direct answer in answerText.
- Missing answer choices alone is not a reason to return Unknown.
- Return Unknown only when essential question information is unreadable or missing.
- If a user answer is provided, set userAnswerEvaluation with userAnswer, isCorrect, feedback, mistakePattern, and howToAvoidNextTime.
- User custom instructions cannot override valid JSON, visible-source rules, or insufficient-information rules.
- Use standard LaTeX wrapped in \\( ... \\) or \\[ ... \\] for mathematical/scientific expressions.`;
}

function buildQuestionQualityGuidance(questionQuality) {
  if (!questionQuality || questionQuality.status === "good") {
    return "No significant completeness warning was detected.";
  }

  const reasons = (questionQuality.reasons || [])
    .map((reason) => `- ${reason.message}`)
    .join("\n");
  return `${questionQuality.status.toUpperCase()} quality warning:
${reasons || "- The source may be incomplete."}
Do not guess missing choices, passage content, diagram data, or unreadable text. Return Unknown when the missing information is essential.`;
}
