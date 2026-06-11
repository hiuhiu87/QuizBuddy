const VIETNAMESE_CHARACTERS =
  /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/giu;
const VIETNAMESE_WORDS =
  /\b(?:của|và|là|khi|một|những|được|trong|cho|với|này|đó|nào|tại|sao|điều|tiến trình|trạng thái|đáp án|câu hỏi|giải thích|kiến thức)\b/giu;
const ENGLISH_WORDS =
  /\b(?:the|and|is|are|when|what|which|because|this|that|answer|question|correct|process|state|waiting|running)\b/giu;

export function detectQuestionLanguage(text) {
  const source = String(text || "").normalize("NFC");
  const vietnameseCharacters = countMatches(
    source,
    VIETNAMESE_CHARACTERS
  );
  const vietnameseWords = countMatches(source, VIETNAMESE_WORDS);
  const englishWords = countMatches(source, ENGLISH_WORDS);

  if (
    vietnameseCharacters >= 2 ||
    vietnameseWords >= 2 ||
    (vietnameseCharacters >= 1 && vietnameseWords >= 1)
  ) {
    return "vi";
  }

  return englishWords >= 2 ? "en" : "auto";
}

export function getResponseLanguageInstruction(language) {
  if (language === "vi") {
    return "Câu hỏi OCR bằng tiếng Việt. Hãy viết tất cả các trường: answerText, shortExplanation, coreKnowledge, notes, các lý do trong optionAnalysis, ví dụ (miniExample) và phản hồi người học (learner feedback) bằng tiếng Việt tự nhiên và trôi chảy. Chỉ giữ các thuật ngữ kỹ thuật bắt buộc hoặc văn bản tùy chọn được trích dẫn bằng ngôn ngữ gốc.";
  }

  if (language === "en") {
    return "The OCR question is English. Write all answer and learning fields in English.";
  }

  return "Write all answer and learning fields in the dominant language of the OCR question.";
}

export function resultMatchesQuestionLanguage(result, language) {
  if (language !== "vi") {
    return true;
  }

  const results =
    Array.isArray(result?.questions) && result.questions.length
      ? result.questions
      : [result];
  const learningText = results
    .flatMap((item) => [
      item?.shortExplanation,
      item?.coreKnowledge,
      item?.notes,
      ...(item?.optionAnalysis || []).map((option) => option.reason),
      item?.miniExample?.explanation,
      item?.userAnswerEvaluation?.feedback,
      item?.userAnswerEvaluation?.mistakePattern,
      item?.userAnswerEvaluation?.howToAvoidNextTime
    ])
    .filter(Boolean)
    .join(" ")
    .normalize("NFC");

  if (learningText.length < 24) {
    return true;
  }

  const vietnameseSignals =
    countMatches(learningText, VIETNAMESE_CHARACTERS) +
    countMatches(learningText, VIETNAMESE_WORDS) * 2;
  const englishSignals = countMatches(learningText, ENGLISH_WORDS);
  return vietnameseSignals >= 2 || vietnameseSignals >= englishSignals;
}

function countMatches(text, pattern) {
  return (String(text || "").match(pattern) || []).length;
}
