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
  buildContradictionRetryPrompt,
  buildFastSingleQuestionPrompt,
  buildCompactRetryPrompt,
  buildMinimalJSONAnswerPrompt
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
  detectRequiredAnswerCount,
  estimateQuestionCount,
  getQuestionScopeText,
  inferQuestionLineScopes,
  remapQuestionToSourceScope
} from "./lib/question-batch.js";
import { numberOcrLines } from "./lib/source-trace.js";
import { pipeline, env } from "@huggingface/transformers";
import {
  detectFormulaSignals,
  extractFormulaBoundingBoxes,
  mergeTextAndFormulas,
  normalizeFormulaLatex,
  calculateFormulaConfidence
} from "./lib/formula-detection.js";

const MIN_OCR_TEXT_LENGTH = 8;
const ANALYSIS_TIMEOUT_MS = 60000;
const ANALYSIS_TOTAL_TIMEOUT_MS = 210000;
const RECOVERY_CHUNK_SIZE = 1;
const LONG_BATCH_CHUNK_SIZE = 1;
const FAST_SINGLE_QUESTION_MAX_TOKENS = 420;
const QUICK_SINGLE_QUESTION_MAX_TOKENS = 320;
const RAW_AI_LOG_MAX_CHARS = 12000;

let webllmEnginePromise = null;
let loadedModelId = null;
let ocrWorkerPromise = null;
let mathOCRPipelinePromise = null;
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
    const timings = {};
    const startedAt = performance.now();
    reportProgress("crop", "Cropping screenshot...", 0.05);
    const croppedImageDataUrl = await cropScreenshot(screenshotDataUrl, rect);
    timings.cropMs = Math.round(performance.now() - startedAt);
    throwIfCancelled(taskId);
    reportPartial({ croppedImageDataUrl });

    let ocrText;
    let ocrConfidence;
    let formulas = [];
    let hasFormulas = false;
    try {
      const ocrStartedAt = performance.now();
      reportProgress("ocr", "Running OCR locally...", 0.12);
      const ocrResult = await runLocalOCR(
        croppedImageDataUrl,
        ocrLanguage
      );
      ocrText = normalizeOCRText(ocrResult.text);
      ocrConfidence = ocrResult.confidence;

      // Detect formula signals
      const formulaSignals = detectFormulaSignals(ocrText, ocrResult);
      if (formulaSignals.hasFormulas) {
        reportProgress("ocr", "Detecting math formulas...", 0.44);
        const formulaBboxes = extractFormulaBoundingBoxes(ocrResult);
        
        if (formulaBboxes.length > 0) {
          hasFormulas = true;
          reportProgress("ocr", `Recognizing ${formulaBboxes.length} formulas...`, 0.46);
          const pipe = await getMathOCRPipeline();
          throwIfCancelled(taskId);

          for (let i = 0; i < formulaBboxes.length; i++) {
            const bbox = formulaBboxes[i];
            const placeholder = `$$FORMULA_${i + 1}$$`;
            
            // Sub-crop formula image
            const subImage = await cropSubImage(croppedImageDataUrl, bbox);
            throwIfCancelled(taskId);

            const progressFraction = 0.46 + (i / formulaBboxes.length) * 0.05;
            reportProgress(
              "ocr",
              `OCR: Recognizing formula ${i + 1}/${formulaBboxes.length}...`,
              progressFraction
            );

            const mathResult = await pipe(subImage);
            throwIfCancelled(taskId);
            
            const rawLatex = mathResult[0]?.generated_text || "";
            const normalizedLatex = normalizeFormulaLatex(rawLatex);
            const mathConf = calculateFormulaConfidence(normalizedLatex, 90);

            formulas.push({
              latex: normalizedLatex,
              placeholder,
              confidence: mathConf,
              bbox
            });
          }

          // Spatial merge
          ocrText = mergeTextAndFormulas(ocrText, formulas, ocrResult.words);
        }
      }

      timings.ocrMs = Math.round(performance.now() - ocrStartedAt);
      reportPartial({ ocrText, ocrConfidence, formulas, hasFormulas });
      throwIfCancelled(taskId);
    } catch (error) {
      return {
        ok: false,
        stage: "ocr",
        error: error.message,
        croppedImageDataUrl,
        formulas,
        hasFormulas
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
        ocrConfidence,
        formulas,
        hasFormulas
      };
    }

    const qualityStartedAt = performance.now();
    reportProgress("quality", "Reviewing question quality...", 0.52);
    const questionQuality = detectQuestionQuality({
      text: ocrText,
      ocrConfidence,
      subject,
      mode
    });
    timings.qualityMs = Math.round(performance.now() - qualityStartedAt);
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
        questionQuality,
        formulas,
        hasFormulas
      };
    }

    try {
      const webllmStartedAt = performance.now();
      reportProgress("webllm", "Analyzing with local WebLLM...", 0.55);
      const aiResult = await runWebLLMAnalysis(ocrText, modelId, {
        ocrConfidence,
        mode,
        subject,
        userSelectedAnswer,
        questionQuality,
        analyzeAnyway,
        customInstruction,
        formulas,
        hasFormulas
      });
      timings.webllmMs = Math.round(performance.now() - webllmStartedAt);
      timings.totalMs = Math.round(performance.now() - startedAt);
      logPerformanceTiming("process-image", timings);
      throwIfCancelled(taskId);
      reportProgress("done", "Done.", 1);
      return {
        ok: true,
        croppedImageDataUrl,
        ocrText,
        ocrConfidence,
        questionQuality,
        aiResult,
        timings,
        formulas,
        hasFormulas
      };
    } catch (error) {
      return {
        ok: false,
        stage: "webllm",
        error: error.message,
        croppedImageDataUrl,
        ocrText,
        ocrConfidence,
        formulas,
        hasFormulas
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
  analyzeAnyway = false,
  formulas = [],
  hasFormulas = false
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
    const startedAt = performance.now();
    const qualityStartedAt = performance.now();
    const questionQuality = detectQuestionQuality({
      text: normalizedText,
      ocrConfidence: null,
      subject,
      mode
    });
    const webllmStartedAt = performance.now();
    reportProgress("webllm", "Analyzing edited text locally...", 0.1);
    const aiResult = await runWebLLMAnalysis(normalizedText, modelId, {
      userCorrected: true,
      mode,
      subject,
      userSelectedAnswer,
      questionQuality,
      analyzeAnyway,
      customInstruction,
      formulas,
      hasFormulas
    });
    const timings = {
      qualityMs: Math.round(webllmStartedAt - qualityStartedAt),
      webllmMs: Math.round(performance.now() - webllmStartedAt),
      totalMs: Math.round(performance.now() - startedAt)
    };
    logPerformanceTiming("analyze-text", timings);
    throwIfCancelled(requestId);
    reportProgress("done", "Done.", 1);
    return {
      ok: true,
      ocrText: normalizedText,
      questionQuality,
      aiResult,
      timings,
      formulas,
      hasFormulas
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
    const practiceContent = response?.choices?.[0]?.message?.content || "";
    logRawAIResponse("practice", practiceContent);
    const result = parsePracticeResult(
      practiceContent
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
    logRawAIResponse("followup", content);
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
    "OCR confidence is low. Retrying with enhanced text preprocessing...",
    0.48
  );
  const candidates = [
    {
      result: primaryResult,
      mode: "grayscale",
      psm: "6"
    }
  ];
  const retryConfigs = [
    { mode: "sharp", psm: "6", progress: 0.5 },
    { mode: "binary", psm: "6", progress: 0.53 },
    { mode: "color", psm: "3", progress: 0.56 },
    { mode: "sharp", psm: "4", progress: 0.59 }
  ];

  for (const config of retryConfigs) {
    reportProgress(
      "ocr",
      `OCR: retrying ${config.mode} / layout ${config.psm}...`,
      config.progress
    );
    await worker.setParameters({
      tessedit_pageseg_mode: config.psm
    });
    const image = await prepareImageForOCR(croppedImageDataUrl, config.mode);
    const result = await worker.recognize(image);
    candidates.push({
      result,
      mode: config.mode,
      psm: config.psm
    });
    if (isOCRResultReliable(result) && scoreOCRResult(result) >= scoreOCRResult(primaryResult) + 8) {
      break;
    }
  }

  await worker.setParameters({
    tessedit_pageseg_mode: "6"
  });

  const best = candidates.reduce((bestCandidate, candidate) =>
    scoreOCRResult(candidate.result) > scoreOCRResult(bestCandidate.result)
      ? candidate
      : bestCandidate
  );
  console.info(
    `[QuizBuddy OCR] selected ${best.mode}/psm${best.psm} score=${Math.round(scoreOCRResult(best.result))}`
  );
  const bestResult = best.result;
  return toOCRResult(bestResult);
}

function toOCRResult(result) {
  return {
    text: result?.data?.text || "",
    confidence: Math.max(
      0,
      Math.min(100, Number(result?.data?.confidence) || 0)
    ),
    words: result?.data?.words || []
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
    const contrastMultiplier = mode === "sharp" ? 1.9 : 1.6;
    let contrasted = Math.max(
      0,
      Math.min(255, (normalizedGray - 128) * contrastMultiplier + 128)
    );
    if (mode === "binary") {
      contrasted = contrasted > 176 ? 255 : 0;
    }
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
  if (estimatedQuestionCount >= 2) {
    const result = await recoverQuestionsByScope({
      engine,
      ocrText,
      sourceQuality,
      targetLanguage,
      analysisDeadline,
      chunkSize:
        estimatedQuestionCount >= 5
          ? LONG_BATCH_CHUNK_SIZE
          : RECOVERY_CHUNK_SIZE
    });
    return finalizeAnalysisResult(
      result,
      estimatedQuestionCount,
      sourceQuality
    );
  }
  const useCompactBatchPrompt = estimatedQuestionCount >= 2;
  const useFastSinglePrompt = estimatedQuestionCount === 1;
  const tokensPerQuestion = useCompactBatchPrompt
    ? 220
    : useFastSinglePrompt
      ? sourceQuality.mode === "quick"
        ? QUICK_SINGLE_QUESTION_MAX_TOKENS
        : FAST_SINGLE_QUESTION_MAX_TOKENS
      : sourceQuality.mode === "quick"
        ? 240
        : 520;
  const maxTokens = Math.min(
    useCompactBatchPrompt
      ? 1800
      : useFastSinglePrompt
        ? sourceQuality.mode === "quick"
          ? QUICK_SINGLE_QUESTION_MAX_TOKENS
          : FAST_SINGLE_QUESTION_MAX_TOKENS
        : sourceQuality.mode === "quick"
          ? 1200
          : 1800,
    Math.max(
      useCompactBatchPrompt
        ? 500
        : useFastSinglePrompt
          ? sourceQuality.mode === "quick"
            ? 280
            : 380
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
        content: targetLanguage === "vi"
          ? `Bạn là QuizBuddy AI, một gia sư học tập tại địa phương và riêng tư. Trả lời cả câu hỏi trắc nghiệm và câu hỏi tự luận. Xác minh các lựa chọn hiển thị, chỉ ra sự không chắc chắn và chỉ trả về đối tượng JSON hợp lệ.

${getResponseLanguageInstruction(targetLanguage)}`
          : `You are QuizBuddy AI, a private local learning tutor. Answer both multiple-choice questions and question-only direct-answer prompts. Verify visible choices, expose uncertainty, and return valid JSON only.

${getResponseLanguageInstruction(targetLanguage)}`
      },
      {
        role: "user",
        content: useCompactBatchPrompt
          ? buildCompactRetryPrompt(ocrText, {
              subject: sourceQuality.subject,
              forceLanguage: targetLanguage,
              formulas: sourceQuality.formulas
            })
          : useFastSinglePrompt
            ? buildFastSingleQuestionPrompt(ocrText, {
                subject: sourceQuality.subject,
                forceLanguage: targetLanguage,
                userSelectedAnswer: sourceQuality.userSelectedAnswer,
                customInstruction: sourceQuality.customInstruction,
                formulas: sourceQuality.formulas
              })
          : buildAnalysisPrompt(ocrText, sourceQuality)
      }
    ],
    temperature: 0,
    max_tokens: maxTokens,
    response_format: { type: "json_object" }
  }, getRemainingAnalysisTime(analysisDeadline));

  const content = response?.choices?.[0]?.message?.content || "";
  logRawAIResponse("analysis", content);
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
  const hasSingleQuestionContradiction =
    estimatedQuestionCount === 1 &&
    hasRawSingleQuestionContradiction(content, ocrText);
  const hasMalformedModelContent = isMalformedModelContent(content);
  if (
    estimatedQuestionCount === 1 &&
    (hasMalformedModelContent ||
      result.parseStatus === "fallback" ||
      languageMismatch ||
      incompleteBatch ||
      hasSingleQuestionContradiction ||
      hasUnknownAnswer ||
      hasAnswerCountMismatch)
  ) {
    reportProgress(
      "webllm",
      languageMismatch
        ? "The local model used the wrong language. Retrying in the question language..."
        : incompleteBatch
          ? `Only ${result.questionCount} of approximately ${estimatedQuestionCount} questions were returned. Retrying the full batch...`
        : hasMalformedModelContent || result.parseStatus === "fallback"
          ? "The local model returned malformed JSON. Retrying with a strict JSON-only prompt..."
          : hasSingleQuestionContradiction
          ? "The local model contradicted itself. Retrying with a stricter answer-only prompt..."
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
          content: targetLanguage === "vi"
            ? `Chỉ trả về một đối tượng JSON nhỏ và hợp lệ. Không sử dụng định dạng markdown. Giải quyết câu hỏi; không bao giờ sao chép mô tả lược đồ hoặc giá trị ví dụ vào các trường câu trả lời.

${getResponseLanguageInstruction(targetLanguage)}`
            : `Return one small valid JSON object only. Do not use markdown. Solve the question; never copy schema descriptions or example values into answer fields.

${getResponseLanguageInstruction(targetLanguage)}`
        },
        {
          role: "user",
          content: hasSingleQuestionContradiction
            ? buildContradictionRetryPrompt(ocrText, {
                previousResponse: content,
                subject: sourceQuality.subject,
                forceLanguage: targetLanguage,
                userSelectedAnswer: sourceQuality.userSelectedAnswer,
                formulas: sourceQuality.formulas
              })
            : hasMalformedModelContent ||
                result.parseStatus === "fallback" ||
                hasUnknownAnswer
              ? buildMinimalJSONAnswerPrompt(ocrText, {
                  subject: sourceQuality.subject,
                  forceLanguage: targetLanguage,
                  userSelectedAnswer: sourceQuality.userSelectedAnswer,
                  formulas: sourceQuality.formulas
                })
            : buildCompactRetryPrompt(ocrText, {
                subject: sourceQuality.subject,
                forceLanguage: targetLanguage,
                formulas: sourceQuality.formulas
              })
        }
      ],
      temperature: 0,
      max_tokens: hasSingleQuestionContradiction
        ? 420
        : hasMalformedModelContent ||
            result.parseStatus === "fallback" ||
            hasUnknownAnswer
          ? 520
          : Math.min(1800, Math.max(500, estimatedQuestionCount * 320))
    }, getRemainingAnalysisTime(analysisDeadline));
    const retryContent = retryResponse?.choices?.[0]?.message?.content || "";
    logRawAIResponse("analysis-retry", retryContent);
    result = parseAIResult(
      retryContent,
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
  const hasUserSelectedAnswer = Boolean(
    String(sourceQuality.userSelectedAnswer || "").trim()
  );
  const questions = result.questions.map((question) => ({
    ...question,
    userAnswerEvaluation: hasUserSelectedAnswer
      ? question.userAnswerEvaluation
      : null,
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
          content: targetLanguage === "vi"
            ? `Trả lời từng câu hỏi trong nhóm được thu hẹp này và chỉ trả về một đối tượng JSON nhỏ và hợp lệ. Không sử dụng định dạng markdown.

${getResponseLanguageInstruction(targetLanguage)}`
            : `Answer every question in this scoped group and return one small valid JSON object only. Do not use markdown.

${getResponseLanguageInstruction(targetLanguage)}`
        },
        {
          role: "user",
          content: buildCompactRetryPrompt(scopedText, {
            subject: sourceQuality.subject,
            forceLanguage: targetLanguage,
            formulas: sourceQuality.formulas
          })
        }
      ],
      temperature: 0,
      max_tokens: Math.min(800, Math.max(320, chunkScopes.length * 220)),
      response_format: { type: "json_object" }
    }, Math.min(45000, getRemainingAnalysisTime(analysisDeadline)));
    const content = response?.choices?.[0]?.message?.content || "";
    logRawAIResponse("analysis-scope", content);
    let parsed = parseAIResult(
      content,
      scopedText,
      {
        requestedMode: sourceQuality.mode,
        userSelectedAnswer: applyUserAnswer
          ? sourceQuality.userSelectedAnswer
          : ""
      }
    );

    if (
      isMalformedModelContent(content) ||
      parsed.parseStatus === "fallback" ||
      !hasAcceptableScopedQuestions(parsed, chunkScopes.length)
    ) {
      const retryResponse = await createChatCompletionWithTimeout(engine, {
        messages: [
          {
            role: "system",
            content: targetLanguage === "vi"
              ? `Chỉ trả về một đối tượng JSON hợp lệ. Ký tự đầu tiên phải là { và ký tự cuối cùng phải là }.`
              : `Return one valid JSON object only. The first character must be { and the last character must be }.`
          },
          {
            role: "user",
            content: buildMinimalJSONAnswerPrompt(scopedText, {
              subject: sourceQuality.subject,
              forceLanguage: targetLanguage,
              userSelectedAnswer: applyUserAnswer
                ? sourceQuality.userSelectedAnswer
                : "",
              formulas: sourceQuality.formulas
            })
          }
        ],
        temperature: 0,
        max_tokens: Math.min(640, Math.max(360, chunkScopes.length * 260))
      }, Math.min(45000, getRemainingAnalysisTime(analysisDeadline)));
      const retryContent = retryResponse?.choices?.[0]?.message?.content || "";
      logRawAIResponse("analysis-scope-retry", retryContent);
      parsed = parseAIResult(
        retryContent,
        scopedText,
        {
          requestedMode: sourceQuality.mode,
          userSelectedAnswer: applyUserAnswer
            ? sourceQuality.userSelectedAnswer
            : ""
        }
      );
    }

    if (hasAcceptableScopedQuestions(parsed, chunkScopes.length)) {
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

function hasAcceptableScopedQuestions(parsed, expectedCount) {
  return (
    parsed.questionCount >= expectedCount &&
    !parsed.questions
      .slice(0, expectedCount)
      .some(
        (question) =>
          isUnknownQuestion(question) || question.answerCountMismatch
      )
  );
}

function isMalformedModelContent(content) {
  const raw = String(content || "").trim();
  if (!raw) {
    return true;
  }
  if (/^_?invalid_?\s+json\b/i.test(raw)) {
    return true;
  }
  if (/json parse error/i.test(raw)) {
    return true;
  }

  const parsed = parseRawAIJSONObject(raw);
  if (!parsed) {
    return true;
  }
  if (Array.isArray(parsed)) {
    return true;
  }
  if (
    !Array.isArray(parsed.questions) &&
    !Object.prototype.hasOwnProperty.call(parsed, "answerText") &&
    !Object.prototype.hasOwnProperty.call(parsed, "answerSelections")
  ) {
    return true;
  }
  return false;
}

function hasRawSingleQuestionContradiction(content, ocrText) {
  const parsed = parseRawAIJSONObject(content);
  if (!parsed) {
    return false;
  }

  const question = Array.isArray(parsed.questions)
    ? parsed.questions[0]
    : parsed;
  if (!question || typeof question !== "object") {
    return false;
  }

  const requiredAnswerCount =
    normalizeRawAnswerCount(question.requiredAnswerCount) ??
    detectRequiredAnswerCount(ocrText);
  const selections = Array.isArray(question.answerSelections)
    ? question.answerSelections
    : [];
  if ((requiredAnswerCount === null || requiredAnswerCount === 1) && selections.length > 1) {
    return true;
  }

  const visibleLabels = extractVisibleChoiceLabels(ocrText);
  const finalLabel =
    extractVisibleLabelFromRaw(question.answerLabel, visibleLabels) ||
    extractVisibleLabelFromRaw(question.answerText, visibleLabels);
  const feedbackLabel = extractCorrectLabelFromRawFeedback(
    question.userAnswerEvaluation,
    visibleLabels
  );

  return Boolean(finalLabel && feedbackLabel && finalLabel !== feedbackLabel);
}

function parseRawAIJSONObject(content) {
  const source = String(content || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const firstBrace = source.indexOf("{");
  const lastBrace = source.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return null;
  }

  try {
    return JSON.parse(source.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

function normalizeRawAnswerCount(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const count = Number(value);
  return Number.isInteger(count) && count >= 1 && count <= 10
    ? count
    : null;
}

function extractVisibleChoiceLabels(text) {
  return new Set(
    String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim().match(/^([A-Z]|\d{1,2})\s*[.):\-]\s*\S/i)?.[1])
      .filter(Boolean)
      .map((label) => label.toUpperCase())
  );
}

function extractVisibleLabelFromRaw(value, visibleLabels) {
  if (!visibleLabels.size) {
    return "";
  }

  const source = String(value || "").trim().toUpperCase();
  const match = source.match(/^([A-Z]|\d{1,2})(?:\s*[.):\-]|\s*$)/);
  const label = match?.[1] || "";
  return visibleLabels.has(label) ? label : "";
}

function extractCorrectLabelFromRawFeedback(evaluation, visibleLabels) {
  if (!evaluation || typeof evaluation !== "object" || !visibleLabels.size) {
    return "";
  }

  const source = removeRawDiacritics(
    [
      evaluation.feedback,
      evaluation.mistakePattern,
      evaluation.howToAvoidNextTime
    ]
      .filter(Boolean)
      .join(" ")
  ).toLowerCase();
  const match = source.match(
    /(?:dap an dung|correct answer|right answer|answer)\s*(?:la|is|:)?\s*([a-z0-9]{1,3})\b/i
  );
  const label = match?.[1]?.toUpperCase() || "";
  return visibleLabels.has(label) ? label : "";
}

function removeRawDiacritics(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[Đđ]/g, (character) => (character === "Đ" ? "D" : "d"));
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
    releaseOCRWorker(),
    releaseMathOCRSession()
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

function logPerformanceTiming(label, timings) {
  const summary = Object.entries(timings)
    .map(([key, value]) => `${key}=${value}ms`)
    .join(" ");
  console.info(`[QuizBuddy performance] ${label} ${summary}`);
}

function logRawAIResponse(label, content) {
  const raw = String(content || "");
  const visibleContent = raw.slice(0, RAW_AI_LOG_MAX_CHARS);
  const truncated = Math.max(0, raw.length - RAW_AI_LOG_MAX_CHARS);
  const suffix =
    truncated > 0
      ? `\n...[truncated ${truncated} chars]`
      : "";
  console.info(
    `[QuizBuddy raw AI] ${label} (${raw.length} chars)\n${visibleContent}${suffix}`
  );
  reportRawAIResponse({
    label,
    content: visibleContent,
    rawLength: raw.length,
    truncated
  });
}

function reportRawAIResponse(payload) {
  if (!activeRequestId) {
    return;
  }

  chrome.runtime
    .sendMessage({
      type: "QB_PROCESS_RAW_AI",
      requestId: activeRequestId,
      taskId: activeRequestId,
      ...payload
    })
    .catch(() => {});
}

async function getMathOCRPipeline() {
  if (!mathOCRPipelinePromise) {
    reportProgress("ocr", "Initializing Math OCR model...", 0.46);

    env.allowLocalModels = false;
    env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("vendor/onnx/");
    env.backends.onnx.wasm.numThreads = 1;

    mathOCRPipelinePromise = pipeline("image-to-text", "Xenova/texify", {
      progress_callback: (data) => {
        if (data.status === "downloading") {
          const progress = 0.46 + (Number(data.progress) || 0) * 0.05;
          reportProgress(
            "ocr",
            `Downloading Math OCR model: ${Math.round(data.progress)}%`,
            progress
          );
        }
      }
    }).catch((error) => {
      mathOCRPipelinePromise = null;
      throw error;
    });
  }
  return mathOCRPipelinePromise;
}

async function releaseMathOCRSession() {
  const pipePromise = mathOCRPipelinePromise;
  mathOCRPipelinePromise = null;

  if (!pipePromise) return;

  try {
    const pipe = await pipePromise;
    await pipe.dispose();
  } catch (error) {
    // Ignore error
  }
}

async function cropSubImage(imageDataUrl, bbox) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = bbox.w;
        canvas.height = bbox.h;
        const ctx = canvas.getContext("2d");

        ctx.drawImage(
          img,
          bbox.x,
          bbox.y,
          bbox.w,
          bbox.h,
          0,
          0,
          bbox.w,
          bbox.h
        );

        resolve(canvas.toDataURL("image/png"));
      } catch (error) {
        reject(error);
      }
    };
    img.onerror = () => reject(new Error("Failed to load image for sub-cropping"));
    img.src = imageDataUrl;
  });
}
