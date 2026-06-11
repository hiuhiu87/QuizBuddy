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

// Helper Functions for modular prompt construction
export function buildBaseInstructions() {
  return `=== BASE INSTRUCTIONS ===
Act as an expert, highly careful quiz solver and OCR recovery assistant. Your task is to analyze noisy OCR text and solve the question(s) contained within it.
- Carefully read the numbered OCR text and reconstruct the question(s) and their options from the noisy layout.
- Use the detected question boundaries as a guide when helpful, but do not blindly trust them if the OCR layout suggests a better split.
- Preserve the visible answer labels exactly as they appear in the source (e.g., A, B, C, D, 1, 2, a), b), True, False).
- Never invent or hallucinate answer choices that are not visible in the OCR, unless the input is clearly question-only.
- If answer options are visible, you must answer using ONLY the visible options belonging to that question.
- For question-only input (without any options), answer the question directly with the correct answer in "answerText" and leave "answerLabel" as "".
- Correct obvious OCR spelling and scanning noise only when the context is clear. Do not be overly aggressive with corrections.
- Do not return "Unknown" solely because of spelling errors, broken lines, missing punctuation, or minor OCR artifacts. Solve every readable question.
- Handle multiple-choice, multiple-select, true/false, fill-in-the-blank, short-answer, and matching-style questions when possible.
- Return every visible question in the same order as they appear in the OCR.
- Keep the output compact and concise so multiple questions can fit.`;
}

export function buildSolvingPolicy() {
  return `=== SOLVING POLICY ===
- First, identify the question stem (the main text of the question).
- Second, identify all the answer options that belong to the question.
- Third, determine the expected answer count.
- Fourth, solve the question based on the subject-specific guidance and visible options.
- Fifth, provide a concise explanation.
- For multiple-select questions (where N answers are required, e.g., "Chọn N", "choose N", "select N", "Pick N"), you must return exactly the requested number of answers in your selections.
- If requiredAnswerCount cannot be determined explicitly, infer it based on the question type:
  * single-choice: 1
  * true/false: 1
  * question-only short answer: 1
  * multiple-select: the number required by the instructions, or the best inferred count.
- If there is not enough information to be absolutely certain, still return the best-supported answer with "confidence" set to "low", rather than failing the whole response or returning "Unknown".`;
}

export function buildOcrRepairRules() {
  return `=== OCR REPAIR RULES ===
- Merge broken or wrapped lines when they clearly belong to the same sentence or option.
- Carefully treat common OCR character confusions:
  * O/0 (letter O vs digit 0)
  * I/l/1 (capital I, lowercase L, digit 1)
  * rn/m (letters r and n next to each other vs letter m)
  * cl/d (letters c and l vs letter d)
  * missing accents in Vietnamese (e.g. Cãu/Côu -> Câu, cóc -> các, phỏi -> phải, tach -> tách)
  * broken mathematical symbols
  * misplaced punctuation
- Do not over-correct proper nouns, legal terms, formulas, or foreign words unless they are obviously garbled.
- For German questions, preserve or reconstruct German umlauts (ä, ö, ü, ß) when they can be inferred from context.
- For math/science questions, preserve formulas and units carefully.
- For legal questions, preserve jurisdiction-specific terms when visible.
- If a line looks like an answer option (e.g. starting with A., B.), attach it to the nearest relevant question stem above it.`;
}

export function buildLanguageRules(language, isFast = false) {
  const fields = isFast
    ? 'The "shortExplanation" field must use the required response language.'
    : 'The "shortExplanation", "coreKnowledge", and "notes" fields must use the required response language.';

  return `=== LANGUAGE HANDLING RULES ===
- Output language must follow the required response language: ${getResponseLanguageInstruction(language)}.
- The "questionText" field should preserve the original OCR language when possible.
- ${fields}
- For language-learning questions, do not translate the answer options unless absolutely necessary for the explanation.
- For English/German grammar questions, preserve the target language text exactly where relevant.
- If the OCR text language is mixed, use the dominant language of the question.`;
}

export function buildLatexRules() {
  return `=== LATEX FORMATTING RULES ===
- For all mathematical/scientific expressions in your output fields, use standard LaTeX notation wrapped in \\( ... \\) for inline expressions, or \\[ ... \\] for block equations.
- Use inline \\( ... \\) for short expressions.
- Use \\[ ... \\] only for longer, complex formulas or equations.
- Do not wrap normal conversational text in LaTeX.
- Do not use invalid LaTeX syntax.
- Preserve units outside LaTeX when clearer, unless they are part of the mathematical formula itself.`;
}

export function buildFewShotExamples() {
  return `=== FEW-SHOT EXAMPLES ===
Example 1: Single-choice question with A/B/C/D
OCR Text:
1: Câu 1. Thủ đô của Việt Nam là?
2: A. Hồ Chí Minh
3: B. Hà Nội
4: C. Đà Nẵng
Output JSON:
{
  "questions": [
    {
      "questionNumber": 1,
      "questionText": "Thủ đô của Việt Nam là gì?",
      "questionLineRefs": [1, 2, 3, 4],
      "answerSelections": [{"label": "B", "text": "Hà Nội"}],
      "requiredAnswerCount": 1,
      "answerText": "Hà Nội",
      "answerLabel": "B",
      "confidence": "high",
      "shortExplanation": "Hà Nội là thủ đô chính thức của nước Cộng hòa Xã hội Chủ nghĩa Việt Nam.",
      "coreKnowledge": "Địa lý Việt Nam",
      "notes": ""
    }
  ]
}

Example 2: Multiple-select question with "Choose 2"
OCR Text:
1: Choose 2 primary colors:
2: A. Red
3: B. Green
4: C. Blue
Output JSON:
{
  "questions": [
    {
      "questionNumber": 1,
      "questionText": "Choose 2 primary colors",
      "questionLineRefs": [1, 2, 3, 4],
      "answerSelections": [
        {"label": "A", "text": "Red"},
        {"label": "C", "text": "Blue"}
      ],
      "requiredAnswerCount": 2,
      "answerText": "Red; Blue",
      "answerLabel": "A, C",
      "confidence": "high",
      "shortExplanation": "Red and Blue are primary colors in the RYB/RGB color models.",
      "coreKnowledge": "Color theory",
      "notes": ""
    }
  ]
}

Example 3: Question-only input with no options
OCR Text:
1: What is the square root of 144?
Output JSON:
{
  "questions": [
    {
      "questionNumber": 1,
      "questionText": "What is the square root of 144?",
      "questionLineRefs": [1],
      "answerSelections": [],
      "requiredAnswerCount": 1,
      "answerText": "12",
      "answerLabel": "",
      "confidence": "high",
      "shortExplanation": "12 multiplied by 12 equals 144.",
      "coreKnowledge": "Square roots",
      "notes": ""
    }
  ]
}

Example 4: Noisy OCR question
OCR Text:
1: Côu 1. Đâp án nà0 dúng?
2: 0. 1+1=2
3: B. 1+1=3
Output JSON:
{
  "questions": [
    {
      "questionNumber": 1,
      "questionText": "Đáp án nào đúng?",
      "questionLineRefs": [1, 2, 3],
      "answerSelections": [{"label": "A", "text": "1 + 1 = 2"}],
      "requiredAnswerCount": 1,
      "answerText": "1 + 1 = 2",
      "answerLabel": "A",
      "confidence": "high",
      "shortExplanation": "Phép tính 1 + 1 bằng 2 là chính xác.",
      "coreKnowledge": "Phép cộng cơ bản",
      "notes": "Đã sửa lỗi OCR 'Côu 1. Đâp án nà0 dúng' và nhãn '0' thành 'A'"
    }
  ]
}

Example 5: German grammar question
OCR Text:
1: Wie heißt ___ Hauptstadt von Deutschland?
2: A. der
3: B. die
4: C. das
Output JSON:
{
  "questions": [
    {
      "questionNumber": 1,
      "questionText": "Wie heißt ___ Hauptstadt von Deutschland?",
      "questionLineRefs": [1, 2, 3, 4],
      "answerSelections": [{"label": "B", "text": "die"}],
      "requiredAnswerCount": 1,
      "answerText": "die",
      "answerLabel": "B",
      "confidence": "high",
      "shortExplanation": "Hauptstadt ist feminin, daher ist der bestimmte Artikel 'die'.",
      "coreKnowledge": "German articles",
      "notes": ""
    }
  ]
}

Example 6: Math question with LaTeX output
OCR Text:
1: Find the derivative of f(x) = x^3 + 2x.
Output JSON:
{
  "questions": [
    {
      "questionNumber": 1,
      "questionText": "Find the derivative of \\( f(x) = x^3 + 2x \\).",
      "questionLineRefs": [1],
      "answerSelections": [],
      "requiredAnswerCount": 1,
      "answerText": "\\( f'(x) = 3x^2 + 2 \\)",
      "answerLabel": "",
      "confidence": "high",
      "shortExplanation": "The derivative of \\( x^3 \\) is \\( 3x^2 \\) and the derivative of \\( 2x \\) is 2.",
      "coreKnowledge": "Calculus derivatives",
      "notes": ""
    }
  ]
}
`;
}

export function buildJsonSchemaInstructions(mode, userSelectedAnswer, requiredAnswerCount, linesCount) {
  const normalizedMode = normalizeAnalysisMode(mode);
  const userAnswer = String(userSelectedAnswer || "").trim();
  const formatModeGuidance =
    normalizedMode === "quick"
      ? `Quick Answer mode:
- Keep the explanation to one or two concise sentences.
- Keep optionAnalysis and miniExample empty.`
      : `Learning Mode:
- Explain why the best answer is correct.
- Explain why each visible option is correct or wrong.
- Include a short core concept, study note, and one compact mini example when useful.`;

  return `=== JSON OUTPUT SCHEMA AND CONSTRAINTS ===
The root object of your response must be exactly:
{
  "mode": "${normalizedMode}",
  "questions": [
     ...
  ]
}

No markdown blocks (like \`\`\`json). No comments. No trailing commas. No text before or after JSON. Return valid JSON only. Do not output <think> tags or private reasoning. No extra fields are allowed. Every field listed in the schema below must exist.

For each item in the "questions" array, use this exact schema:
{
  "questionNumber": 1,
  "questionText": "Reconstruct a clean, concise version of the question stem. Do not include options.",
  "questionLineRefs": [1],
  "answerSelections": [
    {
      "label": "Preserve the visible label exactly (e.g. 'A', 'B'), or '' if no label.",
      "text": "The selected visible option text."
    }
  ],
  "requiredAnswerCount": null,
  "answerText": "The selected answer content. For multiple answers, join with '; '.",
  "answerLabel": "The selected answer label(s). For multiple answers, join with ', '. If no visible labels exist, use ''.",
  "confidence": "high/medium/low",
  "shortExplanation": "One short sentence explaining why the answer is correct.",
  "coreKnowledge": "One short phrase naming the concept tested.",
  "notes": "Mention OCR ambiguity, missing options, or assumptions, otherwise use ''.",
  "optionAnalysis": [
    {
      "label": "Option label or ''",
      "text": "Option text",
      "isCorrect": false,
      "reason": "Why this option is correct/wrong"
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

Rules for Fields:
- "questionNumber": Use the visible question number if available. Otherwise, use sequential order starting from 1.
- "questionText": Reconstruct a clean, concise version of the question stem. Do not include unrelated options inside questionText.
- "questionLineRefs": Include line numbers (from 1 to ${linesCount}) containing the question stem and its relevant options.
- "answerSelections": Include SELECTED visible answer option objects only. Do not include all choices. If the input is question-only and has no options, answerSelections must be [].
- "requiredAnswerCount": A positive integer or null.
- "answerText": The selected answer content. Always put the actual answer content in "answerText", not only a letter.
- "answerLabel": The selected answer labels. If there are no visible labels, use "".
- "confidence": Must be exactly one of: "high" (OCR is clear and answer strongly supported), "medium" (minor noise or moderate inference), or "low" (incomplete, ambiguous, or uncertain).
- "shortExplanation": One short sentence explaining why the answer is correct.
- "coreKnowledge": One short phrase naming the concept tested.
- "notes": Mention OCR ambiguity, missing options, or assumptions. Otherwise use "".
- "userAnswerEvaluation": If no user answer is provided, must be null. If user answer is provided, userAnswerEvaluation must contain userAnswer, isCorrect, feedback, mistakePattern, and howToAvoidNextTime.

${formatModeGuidance}`;
}

export function getSubjectGuidance(subject, isFast = false) {
  switch (normalizeSubjectPreset(subject)) {
    case "english":
      return "Focus on grammar, vocabulary, collocation, tense, connectors, reading comprehension, synonym/antonym logic, and sentence meaning. For grammar questions, identify the grammatical role before choosing the answer.";
    case "german":
      return "Focus on articles, gender, plural, cases, declension, conjugation, word order, separable verbs, prepositions, modal verbs, tense, vocabulary, and sentence meaning. Preserve German capitalization and umlauts when inferable.";
    case "math":
      const mathExtra = isFast
        ? "state the key formula."
        : "state the key formula in coreKnowledge.";
      return `Check calculations carefully. Pay attention to units, signs, formulas, and arithmetic. Identify the formula, substitute values, and avoid arithmetic mistakes. Use concise reasoning. For geometry/algebra/statistics, ${mathExtra} Use LaTeX for mathematical expressions.`;
    case "law":
      return "Explain the legal concept carefully. Avoid overconfident conclusions when jurisdiction or facts are incomplete; legal answers may depend on both. Prefer issue-rule-application style in one concise sentence. If facts are insufficient, choose the best-supported answer and mark confidence lower.";
    case "general-knowledge":
      const gkExtra = isFast
        ? "state uncertainty and lower confidence."
        : "state uncertainty in notes and lower confidence.";
      return `Use factual reasoning. If the OCR is unclear or the fact is uncertain, ${gkExtra} Prefer the most widely accepted answer.`;
    case "science":
      return "Focus on scientific principles, chemical formulas, physics equations, biological classifications, and experimental facts.";
    case "history":
      return "Focus on historical events, dates, figures, causes, and consequences.";
    case "geography":
      return "Focus on locations, physical geography, political boundaries, maps, and climate.";
    case "computer-science":
      return "Focus on algorithms, data structures, code execution, syntax, databases, and system design. For operating systems and command-line shell questions, carefully verify input/output redirections: (1) Pipe '|' only redirects standard output (stdout) to standard input (stdin) of the next command; it does NOT redirect standard error (stderr) unless explicitly combined (like '|&' or '2>&1 |'). (2) '>' and '>>' redirect stdout. (3) '2>' redirects stderr. Double check: shell statements claiming '|' redirects stderr (chuyển stderr) are FALSE/Sai (ký hiệu '|' không chuyển hướng stderr, chỉ chuyển stdout).";
    case "economics-business":
      return "Focus on economic theories, financial formulas, market structures, accounting rules, and business strategies.";
    case "language-learning":
      return "Focus on language acquisition, translation, grammar rules, vocabulary, pronunciation, and dialogue completion.";
    default:
      const defaultExtra = isFast
        ? "solve using general reasoning."
        : "solve using general reasoning and select the most relevant concept from the question.";
      return defaultExtra;
  }
}

// Master prompt compiler helper
export function buildFinalQuizPrompt({
  ocrText,
  linesCount,
  sourceQuality,
  subject,
  questionQualityGuidance,
  customInstruction,
  targetLanguage,
  estimatedQuestionCount,
  requiredAnswerCount,
  scopeGuidance,
  batchGuidance,
  mode,
  userSelectedAnswer
}) {
  return `${buildBaseInstructions()}

${buildSolvingPolicy()}

${buildOcrRepairRules()}

${buildLanguageRules(targetLanguage)}

${buildLatexRules()}

${buildFewShotExamples()}

=== CONTEXT ===
Source quality:
${sourceQuality}

Subject guidance:
${getSubjectGuidance(subject)}

Question quality:
${questionQualityGuidance}

User custom instruction:
${customInstruction || "None"}

${batchGuidance}

${scopeGuidance}

First identify every distinct question in the OCR text. The text appears to contain approximately ${estimatedQuestionCount} question(s), but use the actual visible structure rather than trusting this estimate.
${requiredAnswerCount ? `The visible instruction explicitly requires exactly ${requiredAnswerCount} selected answers. Return all ${requiredAnswerCount}, not only the first one.` : ""}

For each question, classify the input:
- "multiple-choice": two or more answer choices are visible.
- "multiple-select": the wording asks for two or more answers, such as "Chọn 3", "choose N", or "select all that apply".
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
${ocrText}
"""

User answer to check:
${userSelectedAnswer ? JSON.stringify(userSelectedAnswer) : "Not provided"}

${buildJsonSchemaInstructions(mode, userSelectedAnswer, requiredAnswerCount, linesCount)}

Rules:
- For mathematical or scientific formulas, write them using standard LaTeX format wrapped in \\( ... \\) for inline formulas, or \\[ ... \\] for block equations. Use these markers in "answerText", "shortExplanation", "coreKnowledge", "notes", and "optionAnalysis".
- Do not include markdown or text outside JSON.
- Do not output <think> tags, private reasoning, or hidden chain-of-thought.
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
- Source trace lineRefs may only reference line numbers 1 through ${linesCount}.
- questionLineRefs may only reference line numbers 1 through ${linesCount}.
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

// Refactored Exported Prompt Builders using the modular helpers

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
  const batchGuidance =
    estimatedQuestionCount > 1
      ? `Batch response guidance:
- Completeness is more important than long explanations: answer every visible question.
- Keep each explanation and note concise enough for all questions to fit.
- For three or more questions, keep miniExample null and make option reasons one short sentence each.`
      : "";

  return buildFinalQuizPrompt({
    ocrText: numberedText,
    linesCount: lines.length,
    sourceQuality,
    subject: normalizedSubject,
    questionQualityGuidance: qualityGuidance,
    customInstruction: normalizedCustomInstruction,
    targetLanguage,
    estimatedQuestionCount,
    requiredAnswerCount,
    scopeGuidance,
    batchGuidance,
    mode: normalizedMode,
    userSelectedAnswer: userAnswer
  });
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

${buildBaseInstructions()}

${buildSolvingPolicy()}

${buildOcrRepairRules()}

${buildLanguageRules(targetLanguage, true)}

${buildLatexRules()}

=== CONTEXT ===
Subject guidance:
${getSubjectGuidance(subject, true)}

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

No markdown. No extra fields. No text outside JSON. No <think> tags or private reasoning.
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

  return `${buildBaseInstructions()}

${buildSolvingPolicy()}

${buildOcrRepairRules()}

${buildLanguageRules(targetLanguage, true)}

${buildLatexRules()}

=== CONTEXT ===
Subject:
${getSubjectGuidance(subject, true)}

OCR lines:
"""
${numberedText}
"""

User answer:
${userAnswer ? JSON.stringify(userAnswer) : "Not provided"}

Return only one JSON object. The first character must be { and the last character must be }.

Schema:
{"questions":[{"questionNumber":1,"questionText":"","questionLineRefs":[1],"answerSelections":[{"label":"","text":""}],"requiredAnswerCount":${requiredAnswerCount || "null"},"answerText":"","answerLabel":"","confidence":"medium","shortExplanation":"","userAnswerEvaluation":null}]}

Rules:
- Output JSON object only. Do not output an array, string, markdown, or explanation outside JSON.
- Do not output <think> tags, private reasoning, or hidden chain-of-thought.
- Answer every visible question in order.
- questionLineRefs may only use line numbers 1 through ${lines.length}.
- If choices are visible, choose from the visible choices only and copy the selected option text.
- If the question has no choices, answer directly.
- Do not return Unknown unless essential question text is unreadable or missing.
- For single-answer questions, answerSelections must contain exactly one item.
- For multiple-select questions, return ${requiredAnswerCount || "all required"} selected items.
- answerSelections, answerText, and answerLabel must describe the same selected answer. If they would conflict, fix them before returning JSON.
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

  return `${buildBaseInstructions()}

${buildSolvingPolicy()}

${buildOcrRepairRules()}

${buildLanguageRules(targetLanguage, true)}

${buildLatexRules()}

=== CONTEXT ===
Subject guidance:
${getSubjectGuidance(subject, true)}

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

The previous JSON answer was internally inconsistent. Resolve the contradiction from the OCR text and return one corrected JSON object only.

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
- Do not output <think> tags, private reasoning, or hidden chain-of-thought.
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

  return `${buildBaseInstructions()}

${buildSolvingPolicy()}

${buildOcrRepairRules()}

${buildLanguageRules(targetLanguage, true)}

${buildLatexRules()}

=== CONTEXT ===
Subject guidance:
${getSubjectGuidance(subject, true)}

${normalizedCustomInstruction ? `User custom instruction:\n${normalizedCustomInstruction}\n` : ""}OCR text:
"""
${numberedText}
"""

User answer to check:
${userAnswer ? JSON.stringify(userAnswer) : "Not provided"}

Solve this single OCR question quickly and return valid JSON only.

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
- Do not output <think> tags, private reasoning, or hidden chain-of-thought.
- questionLineRefs may only reference line numbers 1 through ${lines.length}.
- For multiple-choice input, use the exact visible option label and option text.
- If requiredAnswerCount is null or 1, answerSelections must contain exactly one answer.
- answerLabel must be only the visible label, such as "A" or "B"; never include option text in answerLabel.
- answerText must be the selected option text or direct answer; never include every visible option.
- answerSelections, answerText, and answerLabel must describe the same selected answer. Never return label A with text from option B.
- For multiple-select input, return every selected answer in answerSelections${requiredAnswerCount ? ` and exactly ${requiredAnswerCount} selections` : ""}.
- For direct-answer input, use an empty answerLabel.
- Missing answer choices alone is not a reason to return Unknown.
- Return Unknown only when essential question information is unreadable or missing.
- If a user answer is provided, set userAnswerEvaluation with userAnswer, isCorrect, feedback, mistakePattern, and howToAvoidNextTime.
- If User answer to check is "Not provided", userAnswerEvaluation must be null and you must not invent a user answer.
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
