import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFollowUpPrompt,
  extractStreamingReply,
  parseFollowUpResult
} from "../lib/follow-up.js";

test("follow-up prompt includes OCR, result, source trace, and scope rules", () => {
  const prompt = buildFollowUpPrompt({
    userMessage: "Why is B correct?",
    questionContext: {
      ocrText: "Question\nA. One\nB. Two",
      analysisResult: { answerText: "Two", answerLabel: "B" }
    }
  });
  assert.match(prompt, /\[3\] B\. Two/);
  assert.match(prompt, /"answerText":"Two"/);
  assert.match(prompt, /sourceTrace/);
  assert.match(prompt, /outside the current question/);
});

test("follow-up prompt scopes an explicit batch question", () => {
  const prompt = buildFollowUpPrompt({
    userMessage: "Giải thích câu 2",
    questionContext: {
      ocrText: "Câu 1\nA. Một\nB. Hai\nCâu 2\nA. Ba\nB. Bốn",
      analysisResult: {
        questions: [
          { questionNumber: 1, questionLineRefs: [1, 2, 3] },
          { questionNumber: 2, questionLineRefs: [4, 5, 6] }
        ]
      }
    }
  });
  assert.doesNotMatch(prompt, /\[2\] A\. Một/);
  assert.match(prompt, /\[5\] A\. Ba/);
});

test("follow-up prompt preserves multiple selected answers", () => {
  const prompt = buildFollowUpPrompt({
    userMessage: "Tại sao chọn cả ba?",
    questionContext: {
      ocrText: "Chọn 3\nA. Một\nB. Hai\nC. Ba",
      analysisResult: {
        answerSelections: [
          { label: "A", text: "Một" },
          { label: "B", text: "Hai" },
          { label: "C", text: "Ba" }
        ],
        requiredAnswerCount: 3
      }
    }
  });

  assert.match(prompt, /"answerSelections":\[/);
  assert.match(prompt, /"requiredAnswerCount":3/);
});

test("extracts a reply while streamed JSON is still incomplete", () => {
  assert.equal(
    extractStreamingReply('{"reply":"Giải thích đang được tạo'),
    "Giải thích đang được tạo"
  );
  assert.equal(
    extractStreamingReply('{"reply":"Dòng một\\nDòng hai","confidence"'),
    "Dòng một\nDòng hai"
  );
  assert.equal(
    parseFollowUpResult(
      '{"reply":"Câu trả lời đã stream',
      "Câu hỏi"
    ).reply,
    "Câu trả lời đã stream"
  );
});

test("follow-up parser validates JSON and source references", () => {
  const result = parseFollowUpResult(
    '{"reply":"B matches.","confidence":"high","sourceTrace":[{"claim":"B","lineRefs":[3,9],"reason":"Visible"}],"suggestedActions":["Example"]}',
    "Question\nA. One\nB. Two"
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.sourceTrace[0].lineRefs, [3]);
  assert.deepEqual(result.suggestedActions, ["Example"]);
  assert.equal(parseFollowUpResult("bad").ok, false);
});
