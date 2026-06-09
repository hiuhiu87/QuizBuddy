import {
  CreateMLCEngine,
  deleteModelAllInfoInCache,
  hasModelInCache
} from "@mlc-ai/web-llm";
import { createWorker } from "tesseract.js";
import {
  MODEL_PROFILES,
  getModelProfile,
  getTesseractLanguages,
  normalizeOCRLanguage
} from "./lib/app-config.js";
import {
  calculateCropPixels,
  normalizeOCRText,
  parseAIResult
} from "./lib/processing-utils.js";
import {
  buildAnalysisPrompt,
  buildCompactRetryPrompt
} from "./lib/analysis-prompt.js";
import { calculateOverallReliability } from "./lib/reliability.js";
import {
  buildPracticePrompt,
  parsePracticeResult
} from "./lib/practice-utils.js";
import { buildDeviceDiagnostics } from "./lib/device-diagnostics.js";
import {
  detectQuestionLanguage,
  getResponseLanguageInstruction,
  resultMatchesQuestionLanguage
} from "./lib/language-utils.js";
import { detectQuestionQuality } from "./lib/question-quality.js";
import {
  buildFollowUpPrompt,
  extractStreamingReply,
  parseFollowUpResult
} from "./lib/follow-up.js";
import {
  chunkQuestionScopes,
  estimateQuestionCount,
  getQuestionScopeText,
  inferQuestionLineScopes,
  remapQuestionToSourceScope
} from "./lib/question-batch.js";
import { numberOcrLines } from "./lib/source-trace.js";

const MIN_OCR_TEXT_LENGTH = 8;
const ANALYSIS_TIMEOUT_MS = 60000;
const ANALYSIS_TOTAL_TIMEOUT_MS = 210000;
const RECOVERY_CHUNK_SIZE = 4;
const LONG_BATCH_CHUNK_SIZE = 2;

let webllmEnginePromise = null;
let loadedModelId = null;
let ocrWorkerPromise = null;
let loadedOCRLanguages = null;
let activeRequestId = null;
let lastScreenshotDataUrl = null;
let lastModelLoadStatus = "not-loaded";
let lastModelError = "";
const cancelledTaskIds = new Set();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "QB_OFFSCREEN_MODEL_STATUS") {
    getModelStatus(message.modelId)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error.message || "Could not check the local model."
        });
      });

    return true;
  }

  if (message.type === "QB_OFFSCREEN_PREPARE_MODEL") {
    prepareModel(message.requestId, message.modelId)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error.message || "Could not prepare the local model."
        });
      });

    return true;
  }

  if (message.type === "QB_OFFSCREEN_PROCESS_IMAGE") {
    processImageLocally(message)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error.message || "Failed to process image locally."
        });
      });

    return true;
  }

  if (message.type === "QB_OFFSCREEN_GET_LAST_SCREENSHOT") {
    sendResponse({
      ok: Boolean(lastScreenshotDataUrl),
      screenshotDataUrl: lastScreenshotDataUrl,
      error: lastScreenshotDataUrl
        ? ""
        : "No screenshot is available for re-cropping."
    });
    return false;
  }

  if (message.type === "QB_OFFSCREEN_RECROP_LAST_SCREENSHOT") {
    processLastScreenshot(message)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error.message || "Could not re-crop the screenshot."
        });
      });
    return true;
  }

  if (message.type === "QB_OFFSCREEN_ANALYZE_TEXT") {
    analyzeEditedText(message)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          stage: "webllm",
          error: error.message || "Could not analyze the edited OCR text."
        });
      });

    return true;
  }

  if (message.type === "QB_OFFSCREEN_GENERATE_PRACTICE") {
    generatePracticeQuestion(message)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          stage: "practice",
          error: error.message || "Could not generate a practice question."
        });
      });
    return true;
  }

  if (message.type === "QB_OFFSCREEN_FOLLOW_UP") {
    runFollowUp(message)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          cancelled: isTaskCancelled(message.taskId || message.requestId),
          stage: "followup",
          error: error.message || "Could not answer the follow-up."
        });
      });
    return true;
  }

  if (message.type === "QB_OFFSCREEN_CANCEL_TASK") {
    cancelTask(message.taskId || message.requestId)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "QB_OFFSCREEN_DELETE_MODEL") {
    deleteLocalModel(message)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error.message || "Could not delete the local model."
        });
      });

    return true;
  }

  if (message.type === "QB_OFFSCREEN_RELEASE_RESOURCES") {
    releaseLocalResources()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error.message || "Could not release local AI resources."
        });
      });

    return true;
  }

  if (message.type === "QB_OFFSCREEN_RELEASE_COMPUTE") {
    releaseComputeResources()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error.message || "Could not release local compute resources."
        });
      });
    return true;
  }

  return false;
});

async function getModelStatus(modelId) {
  const selectedProfile = getModelProfile(modelId);
  const models = await Promise.all(
    MODEL_PROFILES.map(async (profile) => ({
      id: profile.id,
      label: profile.label,
      description: profile.description,
      vramRequiredMB: profile.vramRequiredMB,
      cached: await hasModelInCache(profile.id, getWebLLMAppConfig())
    }))
  );
  const selectedModel = models.find(
    (model) => model.id === selectedProfile.id
  );
  const diagnostics = await getDeviceDiagnostics(selectedProfile);

  return {
    ok: true,
    cached: selectedModel.cached,
    ready: Boolean(
      webllmEnginePromise &&
        loadedModelId === selectedProfile.id &&
        selectedModel.cached
    ),
    webgpuAvailable: Boolean(navigator.gpu),
    selectedModel,
    models,
    diagnostics
  };
}

async function prepareModel(requestId, modelId) {
  if (!navigator.gpu) {
    throw new Error(
      "WebGPU is not available. Enable browser hardware acceleration and restart Chrome/Edge."
    );
  }

  activeRequestId = requestId;
  lastModelLoadStatus = "loading";
  lastModelError = "";
  try {
    reportProgress(
      "model",
      "Preparing the local AI model. Keep this browser open...",
      0
    );
    const profile = getModelProfile(modelId);
    await getWebLLMEngine(profile.id);
    lastModelLoadStatus = "ready";
    reportProgress("model-ready", "Local AI model is ready.", 1);
    return {
      ok: true,
      cached: true,
      ready: true,
      modelId: profile.id
    };
  } catch (error) {
    lastModelLoadStatus = "error";
    lastModelError = error.message || "Unknown model load error";
    throw error;
  } finally {
    activeRequestId = null;
  }
}

async function processImageLocally({
  requestId,
  screenshotDataUrl,
  rect,
  modelId,
  ocrLanguage,
  mode,
  subject,
  userSelectedAnswer,
  customInstruction,
  analyzeAnyway
}) {
  if (!screenshotDataUrl || !rect) {
    throw new Error("Screenshot data or crop coordinates are missing.");
  }

  lastScreenshotDataUrl = screenshotDataUrl;
  return processScreenshotLocally({
    requestId,
    screenshotDataUrl,
    rect,
    modelId,
    ocrLanguage,
    mode,
    subject,
    userSelectedAnswer,
    customInstruction,
    analyzeAnyway
  });
}

async function processLastScreenshot(message) {
  if (!lastScreenshotDataUrl) {
    throw new Error(
      "No screenshot is available. Capture a question before using re-crop."
    );
  }

  return processScreenshotLocally({
    ...message,
    screenshotDataUrl: lastScreenshotDataUrl
  });
}

async function processScreenshotLocally({
  requestId,
  screenshotDataUrl,
  rect,
  modelId,
  ocrLanguage,
  mode,
  subject,
  userSelectedAnswer,
  customInstruction,
  analyzeAnyway = false
}) {
  const taskId = requestId;
  activeRequestId = taskId;
  cancelledTaskIds.delete(taskId);

  try {
    reportProgress("crop", "Cropping screenshot...", 0.05);
    const croppedImageDataUrl = await cropScreenshot(screenshotDataUrl, rect);
    throwIfCancelled(taskId);
    reportPartial({ croppedImageDataUrl });

    let ocrText;
    let ocrConfidence;
    try {
      reportProgress("ocr", "Running OCR locally...", 0.12);
      const ocrResult = await runLocalOCR(
        croppedImageDataUrl,
        ocrLanguage
      );
      ocrText = normalizeOCRText(ocrResult.text);
      ocrConfidence = ocrResult.confidence;
      reportPartial({ ocrText, ocrConfidence });
      throwIfCancelled(taskId);
    } catch (error) {
      return {
        ok: false,
        stage: "ocr",
        error: error.message,
        croppedImageDataUrl
      };
    }

    if (ocrText.length < MIN_OCR_TEXT_LENGTH) {
      return {
        ok: false,
        stage: "ocr",
        error:
          "OCR could not detect enough text. Try cropping the complete question more clearly.",
        croppedImageDataUrl,
        ocrText,
        ocrConfidence
      };
    }

    reportProgress("quality", "Reviewing question quality...", 0.52);
    const questionQuality = detectQuestionQuality({
      text: ocrText,
      ocrConfidence,
      subject,
      mode
    });
    reportPartial({ questionQuality });
    if (questionQuality.status === "bad" && !analyzeAnyway) {
      return {
        ok: false,
        requiresQualityDecision: true,
        stage: "quality",
        error: "This question may be incomplete or difficult to read.",
        croppedImageDataUrl,
        ocrText,
        ocrConfidence,
        questionQuality
      };
    }

    try {
      reportProgress("webllm", "Analyzing with local WebLLM...", 0.55);
      const aiResult = await runWebLLMAnalysis(ocrText, modelId, {
        ocrConfidence,
        mode,
        subject,
        userSelectedAnswer,
        questionQuality,
        analyzeAnyway,
        customInstruction
      });
      throwIfCancelled(taskId);
      reportProgress("done", "Done.", 1);
      return {
        ok: true,
        croppedImageDataUrl,
        ocrText,
        ocrConfidence,
        questionQuality,
        aiResult
      };
    } catch (error) {
      return {
        ok: false,
        stage: "webllm",
        error: error.message,
        croppedImageDataUrl,
        ocrText,
        ocrConfidence
      };
    }
  } finally {
    activeRequestId = null;
  }
}

async function analyzeEditedText({
  requestId,
  ocrText,
  modelId,
  mode,
  subject,
  userSelectedAnswer,
  customInstruction,
  analyzeAnyway = false
}) {
  const normalizedText = normalizeOCRText(ocrText || "");
  if (normalizedText.length < MIN_OCR_TEXT_LENGTH) {
    throw new Error(
      "Edited OCR text is too short. Enter the complete question before analyzing again."
    );
  }

  activeRequestId = requestId;
  cancelledTaskIds.delete(requestId);
  try {
    const questionQuality = detectQuestionQuality({
      text: normalizedText,
      ocrConfidence: null,
      subject,
      mode
    });
    reportProgress("webllm", "Analyzing edited text locally...", 0.1);
    const aiResult = await runWebLLMAnalysis(normalizedText, modelId, {
      userCorrected: true,
      mode,
      subject,
      userSelectedAnswer,
      questionQuality,
      analyzeAnyway,
      customInstruction
    });
    throwIfCancelled(requestId);
    reportProgress("done", "Done.", 1);
    return {
      ok: true,
      ocrText: normalizedText,
      questionQuality,
      aiResult
    };
  } finally {
    activeRequestId = null;
  }
}

async function generatePracticeQuestion({
  requestId,
  ocrText,
  aiResult,
  modelId,
  subject
}) {
  activeRequestId = requestId;
  try {
    reportProgress(
      "practice",
      "Generating a similar practice question locally...",
      0.1
    );
    const profile = getModelProfile(modelId);
    const modelCached = await hasModelInCache(
      profile.id,
      getWebLLMAppConfig()
    );
    if (!modelCached) {
      throw new Error("The selected local model is not available.");
    }

    const engine = await getWebLLMEngine(profile.id);
    const response = await engine.chat.completions.create({
      messages: [
        {
          role: "system",
          content:
            "You are a local learning tutor. Create one original practice question and return valid JSON only."
        },
        {
          role: "user",
          content: buildPracticePrompt({
            ocrText,
            aiResult,
            subject
          })
        }
      ],
      temperature: 0.35,
      max_tokens: 500,
      response_format: { type: "json_object" }
    });
    const result = parsePracticeResult(
      response?.choices?.[0]?.message?.content || ""
    );
    if (!result.ok) {
      throw new Error(result.error);
    }
    reportProgress("done", "Practice question ready.", 1);
    return result;
  } finally {
    activeRequestId = null;
  }
}

async function runFollowUp({
  requestId,
  taskId = requestId,
  modelId,
  userMessage,
  questionContext,
  customInstruction
}) {
  const id = taskId || requestId;
  activeRequestId = id;
  cancelledTaskIds.delete(id);
  try {
    const message = String(userMessage || "").trim();
    if (!message || !questionContext?.ocrText || !questionContext?.analysisResult) {
      throw new Error("Analyze a question before asking a follow-up.");
    }
    reportProgress("followup", "Reviewing the current question...", 0.15);
    const profile = getModelProfile(modelId);
    if (!(await hasModelInCache(profile.id, getWebLLMAppConfig()))) {
      throw new Error("The selected local model is not available.");
    }
    const engine = await getWebLLMEngine(profile.id);
    throwIfCancelled(id);
    reportProgress("followup", "Drafting a grounded follow-up answer...", 0.45);
    const stream = await engine.chat.completions.create({
      messages: [
        {
          role: "system",
          content:
            "You are QuizBuddy AI. Answer only about the current analyzed question and return valid JSON."
        },
        {
          role: "user",
          content: buildFollowUpPrompt({
            userMessage: message,
            questionContext,
            customInstruction
          })
        }
      ],
      temperature: 0.15,
      max_tokens: 320,
      stream: true,
      response_format: { type: "json_object" }
    });
    const content = await consumeFollowUpStream(stream, engine, id);
    throwIfCancelled(id);
    reportProgress("parse", "Checking the follow-up response...", 0.9);
    const parsed = parseFollowUpResult(
      content,
      questionContext.ocrText
    );
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    reportProgress("done", "Follow-up ready.", 1);
    return parsed;
  } finally {
    activeRequestId = null;
  }
}

async function consumeFollowUpStream(stream, engine, taskId) {
  let content = "";
  let lastReply = "";
  let lastReportAt = 0;
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    try {
      engine.interruptGenerate?.();
    } catch {
      // The timeout error below remains actionable.
    }
  }, 45000);

  try {
    for await (const chunk of stream) {
      throwIfCancelled(taskId);
      content += chunk?.choices?.[0]?.delta?.content || "";
      const reply = extractStreamingReply(content);
      const now = Date.now();
      if (
        reply &&
        reply !== lastReply &&
        (now - lastReportAt >= 80 || reply.length - lastReply.length >= 24)
      ) {
        lastReply = reply;
        lastReportAt = now;
        reportPartial({ followupText: reply });
      }
      if (timedOut) {
        break;
      }
    }
  } catch (error) {
    if (!timedOut || !extractStreamingReply(content)) {
      throw error;
    }
  } finally {
    clearTimeout(timeoutId);
  }

  const finalReply = extractStreamingReply(content);
  if (finalReply && finalReply !== lastReply) {
    reportPartial({ followupText: finalReply });
  }
  if (timedOut && !finalReply) {
    throw new Error(
      "The local follow-up timed out before producing an answer."
    );
  }
  return content;
}

async function deleteLocalModel({ requestId, modelId }) {
  const profile = getModelProfile(modelId);
  activeRequestId = requestId;

  try {
    reportProgress("model-delete", `Removing ${profile.label} model cache...`, 0);
    if (loadedModelId === profile.id && webllmEnginePromise) {
      const engine = await webllmEnginePromise;
      await engine.unload();
      webllmEnginePromise = null;
      loadedModelId = null;
    }

    await deleteModelAllInfoInCache(profile.id, getWebLLMAppConfig());
    reportProgress("model-deleted", `${profile.label} model cache removed.`, 1);
    return {
      ok: true,
      modelId: profile.id
    };
  } finally {
    activeRequestId = null;
  }
}

async function cropScreenshot(screenshotDataUrl, rect) {
  const image = await loadImage(screenshotDataUrl);
  const { sx, sy, sw, sh } = calculateCropPixels(
    rect,
    image.naturalWidth,
    image.naturalHeight
  );

  if (sw <= 0 || sh <= 0) {
    throw new Error("The selected crop area is outside the captured image.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas context is not available.");
  }

  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.toDataURL("image/png");
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("Failed to load screenshot image."));
    image.src = dataUrl;
  });
}

async function runLocalOCR(croppedImageDataUrl, language) {
  const worker = await getOCRWorker(language);
  const grayscaleImage = await prepareImageForOCR(
    croppedImageDataUrl,
    "grayscale"
  );
  const primaryResult = await worker.recognize(grayscaleImage);

  if (isOCRResultReliable(primaryResult)) {
    return toOCRResult(primaryResult);
  }

  reportProgress(
    "ocr",
    "OCR confidence is low. Retrying with color details...",
    0.48
  );
  const colorImage = await prepareImageForOCR(croppedImageDataUrl, "color");
  const retryResult = await worker.recognize(colorImage);
  const bestResult =
    scoreOCRResult(retryResult) > scoreOCRResult(primaryResult)
      ? retryResult
      : primaryResult;
  return toOCRResult(bestResult);
}

function toOCRResult(result) {
  return {
    text: result?.data?.text || "",
    confidence: Math.max(
      0,
      Math.min(100, Number(result?.data?.confidence) || 0)
    )
  };
}

async function getOCRWorker(language) {
  const normalizedLanguage = normalizeOCRLanguage(language);
  const tesseractLanguages = getTesseractLanguages(normalizedLanguage);

  if (ocrWorkerPromise && loadedOCRLanguages !== tesseractLanguages) {
    await releaseOCRWorker();
  }

  if (!ocrWorkerPromise) {
    loadedOCRLanguages = tesseractLanguages;
    ocrWorkerPromise = createOCRWorker(tesseractLanguages).catch((error) => {
      ocrWorkerPromise = null;
      loadedOCRLanguages = null;
      throw error;
    });
  }

  return ocrWorkerPromise;
}

async function createOCRWorker(tesseractLanguages) {
  try {
    const worker = await createWorker(tesseractLanguages, 1, {
      workerPath: chrome.runtime.getURL("vendor/ocr/worker.min.js"),
      corePath: chrome.runtime.getURL("vendor/ocr/core"),
      langPath: chrome.runtime.getURL("vendor/ocr/lang-data"),
      workerBlobURL: false,
      logger: (message) => {
        if (message.status) {
          const progress = 0.12 + (Number(message.progress) || 0) * 0.4;
          reportProgress("ocr", `OCR: ${message.status}`, progress);
        }
      }
    });
    await worker.setParameters({
      preserve_interword_spaces: "1",
      tessedit_pageseg_mode: "6",
      user_defined_dpi: "300"
    });
    return worker;
  } catch (error) {
    throw new Error(`Local OCR initialization failed: ${error.message}`);
  }
}

async function prepareImageForOCR(dataUrl, mode) {
  const image = await loadImage(dataUrl);
  const scale = Math.min(
    3,
    Math.max(1.5, 1800 / Math.max(image.naturalWidth, 1))
  );
  const padding = Math.round(24 * scale);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.naturalWidth * scale) + padding * 2;
  canvas.height = Math.round(image.naturalHeight * scale) + padding * 2;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  if (!ctx) {
    throw new Error("Canvas context is not available for OCR preprocessing.");
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(
    image,
    padding,
    padding,
    canvas.width - padding * 2,
    canvas.height - padding * 2
  );

  if (mode === "color") {
    return canvas.toDataURL("image/png");
  }

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;
  let brightnessTotal = 0;
  let sampledPixels = 0;

  for (let index = 0; index < pixels.length; index += 40) {
    brightnessTotal +=
      pixels[index] * 0.299 +
      pixels[index + 1] * 0.587 +
      pixels[index + 2] * 0.114;
    sampledPixels += 1;
  }

  const shouldInvert =
    sampledPixels > 0 && brightnessTotal / sampledPixels < 110;

  for (let index = 0; index < pixels.length; index += 4) {
    const gray =
      pixels[index] * 0.299 +
      pixels[index + 1] * 0.587 +
      pixels[index + 2] * 0.114;
    const normalizedGray = shouldInvert ? 255 - gray : gray;
    const contrasted = Math.max(
      0,
      Math.min(255, (normalizedGray - 128) * 1.12 + 128)
    );
    pixels[index] = contrasted;
    pixels[index + 1] = contrasted;
    pixels[index + 2] = contrasted;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

function isOCRResultReliable(result) {
  const confidence = Number(result?.data?.confidence) || 0;
  const text = normalizeOCRText(result?.data?.text || "");
  return confidence >= 68 && text.length >= MIN_OCR_TEXT_LENGTH;
}

function scoreOCRResult(result) {
  const confidence = Number(result?.data?.confidence) || 0;
  const text = normalizeOCRText(result?.data?.text || "");
  const meaningfulCharacters = (text.match(/[\p{L}\p{N}]/gu) || []).length;
  const vietnameseMarks = (
    text.match(/[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/giu) ||
    []
  ).length;

  return confidence + Math.min(20, meaningfulCharacters / 5) + vietnameseMarks;
}

async function runWebLLMAnalysis(ocrText, modelId, sourceQuality = {}) {
  if (!navigator.gpu) {
    throw new Error(
      "WebGPU is not available in this browser. Use a supported Chrome/Edge version and enable hardware acceleration."
    );
  }

  const profile = getModelProfile(modelId);
  const modelCached = await hasModelInCache(
    profile.id,
    getWebLLMAppConfig()
  );
  if (!modelCached) {
    throw new Error(
      "The local AI model has not been downloaded yet. Open QuizBuddy AI and approve the model download first."
    );
  }

  const engine = await getWebLLMEngine(profile.id);
  const analysisDeadline = Date.now() + ANALYSIS_TOTAL_TIMEOUT_MS;
  throwIfCancelled(activeRequestId);
  const targetLanguage = detectQuestionLanguage(ocrText);
  const estimatedQuestionCount = estimateQuestionCount(ocrText);
  if (estimatedQuestionCount >= 5) {
    const result = await recoverQuestionsByScope({
      engine,
      ocrText,
      sourceQuality,
      targetLanguage,
      analysisDeadline,
      chunkSize: LONG_BATCH_CHUNK_SIZE
    });
    return finalizeAnalysisResult(
      result,
      estimatedQuestionCount,
      sourceQuality
    );
  }
  const useCompactBatchPrompt = estimatedQuestionCount >= 2;
  const tokensPerQuestion = useCompactBatchPrompt
    ? 220
    : sourceQuality.mode === "quick"
      ? 240
      : 520;
  const maxTokens = Math.min(
    useCompactBatchPrompt
      ? 1800
      : sourceQuality.mode === "quick"
        ? 1200
        : 1800,
    Math.max(
      useCompactBatchPrompt
        ? 500
        : sourceQuality.mode === "quick"
          ? 450
          : 800,
      estimatedQuestionCount * tokensPerQuestion
    )
  );
  const response = await createChatCompletionWithTimeout(engine, {
    messages: [
      {
        role: "system",
        content: `You are QuizBuddy AI, a private local learning tutor. Answer both multiple-choice questions and question-only direct-answer prompts. Verify visible choices, expose uncertainty, and return valid JSON only.

${getResponseLanguageInstruction(targetLanguage)}`
      },
      {
        role: "user",
        content: useCompactBatchPrompt
          ? buildCompactRetryPrompt(ocrText, {
              subject: sourceQuality.subject,
              forceLanguage: targetLanguage
            })
          : buildAnalysisPrompt(ocrText, sourceQuality)
      }
    ],
    temperature: 0,
    max_tokens: maxTokens,
    response_format: { type: "json_object" }
  }, getRemainingAnalysisTime(analysisDeadline));

  const content = response?.choices?.[0]?.message?.content || "";
  throwIfCancelled(activeRequestId);
  reportProgress("parse", "Checking the local AI response...", 0.78);
  let result = parseAIResult(content, ocrText, {
    requestedMode: sourceQuality.mode,
    userSelectedAnswer: sourceQuality.userSelectedAnswer
  });
  const languageMismatch = !resultMatchesQuestionLanguage(
    result,
    targetLanguage
  );
  const incompleteBatch =
    estimatedQuestionCount > 1 &&
    result.questionCount < estimatedQuestionCount;
  const hasUnknownAnswer = result.questions.some(isUnknownQuestion);
  const hasAnswerCountMismatch = result.questions.some(
    (question) => question.answerCountMismatch
  );
  if (
    estimatedQuestionCount === 1 &&
    (result.parseStatus === "fallback" ||
      languageMismatch ||
      incompleteBatch ||
      hasUnknownAnswer ||
      hasAnswerCountMismatch)
  ) {
    reportProgress(
      "webllm",
      languageMismatch
        ? "The local model used the wrong language. Retrying in the question language..."
        : incompleteBatch
          ? `Only ${result.questionCount} of approximately ${estimatedQuestionCount} questions were returned. Retrying the full batch...`
        : hasUnknownAnswer
          ? "The local model returned Unknown for readable text. Retrying with a compact response..."
          : hasAnswerCountMismatch
            ? "The local model returned the wrong number of selected answers. Retrying all required selections..."
          : "The local model returned malformed JSON. Retrying with a compact response...",
      0.82
    );
    const retryResponse = await createChatCompletionWithTimeout(engine, {
      messages: [
        {
          role: "system",
          content: `Return one small valid JSON object only. Do not use markdown. Solve the question; never copy schema descriptions or example values into answer fields.

${getResponseLanguageInstruction(targetLanguage)}`
        },
        {
          role: "user",
          content: buildCompactRetryPrompt(ocrText, {
            subject: sourceQuality.subject,
            forceLanguage: targetLanguage
          })
        }
      ],
      temperature: 0,
      max_tokens: Math.min(1800, Math.max(500, estimatedQuestionCount * 320)),
      response_format: { type: "json_object" }
    }, getRemainingAnalysisTime(analysisDeadline));
    result = parseAIResult(
      retryResponse?.choices?.[0]?.message?.content || "",
      ocrText,
      {
        requestedMode: sourceQuality.mode,
        userSelectedAnswer: sourceQuality.userSelectedAnswer
      }
    );
    throwIfCancelled(activeRequestId);
  }
  if (
    estimatedQuestionCount > 1 &&
    (result.questionCount < estimatedQuestionCount ||
      result.questions.some(
        (question) =>
          isUnknownQuestion(question) || question.answerCountMismatch
      ))
  ) {
    result = await recoverQuestionsByScope({
      engine,
      ocrText,
      sourceQuality,
      targetLanguage,
      analysisDeadline
    });
  }
  return finalizeAnalysisResult(
    result,
    estimatedQuestionCount,
    sourceQuality
  );
}

function finalizeAnalysisResult(
  result,
  estimatedQuestionCount,
  sourceQuality
) {
  const questions = result.questions.map((question) => ({
    ...question,
    overallReliability: calculateOverallReliability({
      ocrConfidence: sourceQuality.ocrConfidence,
      aiConfidence: question.confidence,
      parseStatus: question.parseStatus || result.parseStatus,
      answerWasExpandedFromOption: question.answerWasExpandedFromOption,
      answerCountMismatch: question.answerCountMismatch,
      requiredAnswerCount: question.requiredAnswerCount,
      wasOcrEdited: sourceQuality.userCorrected === true,
      questionQuality: sourceQuality.questionQuality,
      analyzeAnyway: sourceQuality.analyzeAnyway === true
    })
  }));
  const primary = questions[0] || result;
  const batchIncomplete =
    estimatedQuestionCount > 1 &&
    (questions.length < estimatedQuestionCount ||
      questions.some(
        (question) =>
          isUnknownQuestion(question) || question.answerCountMismatch
      ));

  return {
    ...result,
    ...primary,
    questions,
    questionCount: questions.length,
    isBatch: questions.length > 1,
    estimatedQuestionCount,
    batchIncomplete,
    parseStatus: result.parseStatus
  };
}

async function recoverQuestionsByScope({
  engine,
  ocrText,
  sourceQuality,
  targetLanguage,
  analysisDeadline,
  chunkSize = RECOVERY_CHUNK_SIZE
}) {
  const scopes = inferQuestionLineScopes(ocrText);
  const numberedOCR = numberOcrLines(ocrText);
  const questions = [];
  const chunks = chunkQuestionScopes(scopes, chunkSize);

  for (const [chunkIndex, chunkScopes] of chunks.entries()) {
    throwIfCancelled(activeRequestId);
    reportProgress(
      "webllm",
      `Recovering question group ${chunkIndex + 1} of ${chunks.length}...`,
      0.84 + ((chunkIndex + 1) / chunks.length) * 0.12
    );
    const groupQuestions = await analyzeQuestionScopeGroup({
      engine,
      numberedOCR,
      chunkScopes,
      sourceQuality,
      targetLanguage,
      analysisDeadline,
      applyUserAnswer: chunkIndex === 0
    });
    questions.push(...groupQuestions);
    questions.forEach((question, index) => {
      question.questionNumber = index + 1;
    });
    const partialPrimary = questions[0];
    reportPartial({
      partialAIResult: finalizeAnalysisResult(
        {
          ...partialPrimary,
          questions: [...questions],
          questionCount: questions.length,
          isBatch: questions.length > 1,
          parseStatus: questions.some(
            (question) => question.parseStatus === "fallback"
          )
            ? "recovered"
            : "parsed"
        },
        scopes.length,
        sourceQuality
      )
    });
  }

  const primary = questions[0] || parseAIResult("", ocrText);
  return {
    ...primary,
    questions,
    questionCount: questions.length,
    isBatch: questions.length > 1,
    parseStatus: questions.some(
      (question) => question.parseStatus === "fallback"
    )
      ? "recovered"
      : "parsed"
  };
}

async function analyzeQuestionScopeGroup({
  engine,
  numberedOCR,
  chunkScopes,
  sourceQuality,
  targetLanguage,
  analysisDeadline,
  applyUserAnswer
}) {
  const sourceLineRefs = chunkScopes.flat();
  const scopedText = getQuestionScopeText(
    numberedOCR.lines,
    sourceLineRefs,
    ""
  );

  try {
    const response = await createChatCompletionWithTimeout(engine, {
      messages: [
        {
          role: "system",
          content: `Answer every question in this scoped group and return one small valid JSON object only. Do not use markdown.

${getResponseLanguageInstruction(targetLanguage)}`
        },
        {
          role: "user",
          content: buildCompactRetryPrompt(scopedText, {
            subject: sourceQuality.subject,
            forceLanguage: targetLanguage
          })
        }
      ],
      temperature: 0,
      max_tokens: Math.min(800, Math.max(320, chunkScopes.length * 220)),
      response_format: { type: "json_object" }
    }, Math.min(45000, getRemainingAnalysisTime(analysisDeadline)));
    const parsed = parseAIResult(
      response?.choices?.[0]?.message?.content || "",
      scopedText,
      {
        requestedMode: sourceQuality.mode,
        userSelectedAnswer: applyUserAnswer
          ? sourceQuality.userSelectedAnswer
          : ""
      }
    );
    if (
      parsed.questionCount >= chunkScopes.length &&
      !parsed.questions
        .slice(0, chunkScopes.length)
        .some(
          (question) =>
            isUnknownQuestion(question) || question.answerCountMismatch
        )
    ) {
      return parsed.questions
        .slice(0, chunkScopes.length)
        .map((question) =>
          remapQuestionToSourceScope(question, sourceLineRefs)
        );
    }
  } catch (error) {
    if (chunkScopes.length === 1) {
      return [
        createTimedOutQuestion(
          scopedText,
          sourceLineRefs,
          sourceQuality.mode,
          error
        )
      ];
    }
  }

  if (chunkScopes.length > 1) {
    const splitQuestions = [];
    for (const [index, scope] of chunkScopes.entries()) {
      splitQuestions.push(
        ...(await analyzeQuestionScopeGroup({
          engine,
          numberedOCR,
          chunkScopes: [scope],
          sourceQuality,
          targetLanguage,
          analysisDeadline,
          applyUserAnswer: applyUserAnswer && index === 0
        }))
      );
    }
    return splitQuestions;
  }

  return [
    createTimedOutQuestion(
      scopedText,
      sourceLineRefs,
      sourceQuality.mode,
      new Error("The local model could not produce a reliable answer.")
    )
  ];
}

function createTimedOutQuestion(
  scopedText,
  sourceLineRefs,
  mode,
  error
) {
  const fallback = parseAIResult("", scopedText, {
    requestedMode: mode
  }).questions[0];
  return {
    ...remapQuestionToSourceScope(fallback, sourceLineRefs),
    questionText: scopedText.split("\n").slice(0, 2).join(" "),
    notes: error.message,
    parseStatus: "fallback"
  };
}

async function createChatCompletionWithTimeout(engine, request, timeoutMs) {
  let timeoutId;
  let timedOut = false;
  const generation = engine.chat.completions.create(request);
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      try {
        engine.interruptGenerate?.();
      } catch {
        // The timeout result below remains actionable.
      }
      resolve(null);
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([generation, timeout]);
    if (!timedOut) {
      return result;
    }
    await Promise.race([
      generation.catch(() => null),
      new Promise((resolve) => setTimeout(resolve, 1500))
    ]);
    throw new Error(
      "Local AI analysis timed out for this question group."
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

function getRemainingAnalysisTime(deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw new Error(
      "Local AI analysis reached its time limit. Try Quick Answer, fewer questions per crop, or a faster model."
    );
  }
  return Math.min(ANALYSIS_TIMEOUT_MS, remaining);
}

function isUnknownQuestion(question) {
  const answer = String(question?.answerText || "")
    .trim()
    .replace(/[.!?。]+$/u, "");
  return /^(?:unknown|không rõ|không xác định|không đủ thông tin|n\/a)$/iu.test(
    answer
  );
}

async function cancelTask(taskId) {
  const id = String(taskId || "");
  if (!id) {
    return { ok: false, error: "Task ID is missing." };
  }
  cancelledTaskIds.add(id);
  if (activeRequestId === id && webllmEnginePromise) {
    try {
      const engine = await webllmEnginePromise;
      if (typeof engine.interruptGenerate === "function") {
        engine.interruptGenerate();
      }
    } catch {
      // Cooperative cancellation still suppresses the eventual result.
    }
  }
  if (activeRequestId === id && ocrWorkerPromise) {
    await releaseOCRWorker();
  }
  return { ok: true, taskId: id };
}

function isTaskCancelled(taskId) {
  return cancelledTaskIds.has(String(taskId || ""));
}

function throwIfCancelled(taskId) {
  if (isTaskCancelled(taskId)) {
    const error = new Error("Task cancelled.");
    error.name = "AbortError";
    throw error;
  }
}

async function getWebLLMEngine(modelId) {
  const profile = getModelProfile(modelId);
  if (webllmEnginePromise && loadedModelId !== profile.id) {
    await releaseWebLLMEngine();
  }

  if (!webllmEnginePromise) {
    loadedModelId = profile.id;
    webllmEnginePromise = createWebLLMEngine(profile).catch((error) => {
      webllmEnginePromise = null;
      loadedModelId = null;
      throw error;
    });
  }

  return webllmEnginePromise;
}

async function releaseLocalResources() {
  lastScreenshotDataUrl = null;
  await releaseComputeResources();
}

async function releaseComputeResources() {
  await Promise.allSettled([
    releaseWebLLMEngine(),
    releaseOCRWorker()
  ]);
}

async function releaseWebLLMEngine() {
  const enginePromise = webllmEnginePromise;
  webllmEnginePromise = null;
  loadedModelId = null;

  if (!enginePromise) {
    return;
  }

  try {
    const engine = await enginePromise;
    await engine.unload();
  } catch {
    // Failed initialization has already cleared its own state.
  }
}

async function releaseOCRWorker() {
  const workerPromise = ocrWorkerPromise;
  ocrWorkerPromise = null;
  loadedOCRLanguages = null;

  if (!workerPromise) {
    return;
  }

  try {
    const worker = await workerPromise;
    await worker.terminate();
  } catch {
    // Failed initialization has already cleared its own state.
  }
}

async function createWebLLMEngine(profile) {
  try {
    return await CreateMLCEngine(
      profile.id,
      {
        appConfig: getWebLLMAppConfig(),
        initProgressCallback: (report) => {
          const percent = Math.round((report.progress || 0) * 100);
          reportProgress(
            "model",
            report.text || `Downloading local model: ${percent}%`,
            report.progress || 0
          );
        },
        logLevel: "WARN"
      },
      {
        context_window_size: 4096
      }
    );
  } catch (error) {
    lastModelLoadStatus = "error";
    lastModelError = error.message || "Unknown WebLLM initialization error";
    throw new Error(`WebLLM initialization failed: ${error.message}`);
  }
}

async function getDeviceDiagnostics(selectedModelProfile) {
  const webgpuAvailable = Boolean(navigator.gpu);
  let adapterInfo = "";

  if (webgpuAvailable) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      const info = adapter?.info;
      adapterInfo = [
        info?.vendor,
        info?.architecture,
        info?.description
      ]
        .filter(Boolean)
        .join(" · ");
    } catch {
      adapterInfo = "";
    }
  }

  return buildDeviceDiagnostics({
    webgpuAvailable,
    adapterInfo,
    selectedModelProfile,
    lastModelStatus: lastModelLoadStatus,
    lastModelError
  });
}

function getWebLLMAppConfig() {
  return {
    useIndexedDBCache: false,
    model_list: MODEL_PROFILES.map((profile) => ({
        model: profile.modelUrl,
        model_id: profile.id,
        model_lib: chrome.runtime.getURL(
          `vendor/webllm/${profile.runtimeFile}`
        ),
        low_resource_required: true,
        vram_required_MB: profile.vramRequiredMB,
        overrides: {
          context_window_size: 4096
        }
      }))
  };
}

function reportProgress(stage, text, progress) {
  if (!activeRequestId) {
    return;
  }

  chrome.runtime
    .sendMessage({
      type: "QB_PROCESS_PROGRESS",
      requestId: activeRequestId,
      taskId: activeRequestId,
      stage,
      text,
      progress
    })
    .catch(() => {});
}

function reportPartial(payload) {
  if (!activeRequestId) {
    return;
  }

  chrome.runtime
    .sendMessage({
      type: "QB_PROCESS_PARTIAL",
      requestId: activeRequestId,
      taskId: activeRequestId,
      ...payload
    })
    .catch(() => {});
}
