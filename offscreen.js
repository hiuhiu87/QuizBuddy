import { CreateMLCEngine, hasModelInCache } from "@mlc-ai/web-llm";
import { createWorker } from "tesseract.js";
import {
  calculateCropPixels,
  normalizeOCRText,
  parseAIResult
} from "./lib/processing-utils.js";

const WEBLLM_MODEL_ID = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";
const WEBLLM_MODEL_URL =
  "https://huggingface.co/mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC";
const WEBLLM_MODEL_LIB =
  "vendor/webllm/Qwen2-1.5B-Instruct-q4f16_1-ctx4k_cs1k-webgpu.wasm";
const MIN_OCR_TEXT_LENGTH = 8;

let webllmEnginePromise = null;
let ocrWorkerPromise = null;
let activeRequestId = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "QB_OFFSCREEN_MODEL_STATUS") {
    getModelStatus()
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
    prepareModel(message.requestId)
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

  return false;
});

async function getModelStatus() {
  const cached = await hasModelInCache(WEBLLM_MODEL_ID, getWebLLMAppConfig());
  return {
    ok: true,
    cached,
    ready: Boolean(webllmEnginePromise && cached),
    webgpuAvailable: Boolean(navigator.gpu)
  };
}

async function prepareModel(requestId) {
  if (!navigator.gpu) {
    throw new Error(
      "WebGPU is not available. Enable browser hardware acceleration and restart Chrome/Edge."
    );
  }

  activeRequestId = requestId;
  try {
    reportProgress(
      "model",
      "Preparing the local AI model. Keep this browser open...",
      0
    );
    await getWebLLMEngine();
    reportProgress("model-ready", "Local AI model is ready.", 1);
    return {
      ok: true,
      cached: true,
      ready: true
    };
  } finally {
    activeRequestId = null;
  }
}

async function processImageLocally({ requestId, screenshotDataUrl, rect }) {
  if (!screenshotDataUrl || !rect) {
    throw new Error("Screenshot data or crop coordinates are missing.");
  }

  activeRequestId = requestId;

  try {
    reportProgress("crop", "Cropping screenshot...", 0.05);
    const croppedImageDataUrl = await cropScreenshot(screenshotDataUrl, rect);
    reportPartial({ croppedImageDataUrl });

    let ocrText;
    try {
      reportProgress("ocr", "Running OCR locally...", 0.12);
      ocrText = normalizeOCRText(await runLocalOCR(croppedImageDataUrl));
      reportPartial({ ocrText });
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
        ocrText
      };
    }

    try {
      reportProgress("webllm", "Analyzing with local WebLLM...", 0.55);
      const aiResult = await runWebLLMAnalysis(ocrText);
      reportProgress("done", "Done.", 1);
      return {
        ok: true,
        croppedImageDataUrl,
        ocrText,
        aiResult
      };
    } catch (error) {
      return {
        ok: false,
        stage: "webllm",
        error: error.message,
        croppedImageDataUrl,
        ocrText
      };
    }
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

async function runLocalOCR(croppedImageDataUrl) {
  const worker = await getOCRWorker();
  const grayscaleImage = await prepareImageForOCR(
    croppedImageDataUrl,
    "grayscale"
  );
  const primaryResult = await worker.recognize(grayscaleImage);

  if (isOCRResultReliable(primaryResult)) {
    return primaryResult?.data?.text || "";
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
  return bestResult?.data?.text || "";
}

async function getOCRWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = createOCRWorker().catch((error) => {
      ocrWorkerPromise = null;
      throw error;
    });
  }

  return ocrWorkerPromise;
}

async function createOCRWorker() {
  try {
    const worker = await createWorker("vie+eng", 1, {
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

async function runWebLLMAnalysis(ocrText) {
  if (!navigator.gpu) {
    throw new Error(
      "WebGPU is not available in this browser. Use a supported Chrome/Edge version and enable hardware acceleration."
    );
  }

  const modelCached = await hasModelInCache(
    WEBLLM_MODEL_ID,
    getWebLLMAppConfig()
  );
  if (!modelCached) {
    throw new Error(
      "The local AI model has not been downloaded yet. Open QuizBuddy AI and approve the model download first."
    );
  }

  const engine = await getWebLLMEngine();
  const response = await engine.chat.completions.create({
    messages: [
      {
        role: "user",
        content: buildAnalysisPrompt(ocrText)
      }
    ],
    temperature: 0.1,
    max_tokens: 500,
    response_format: { type: "json_object" }
  });

  const content = response?.choices?.[0]?.message?.content || "";
  return parseAIResult(content, ocrText);
}

async function getWebLLMEngine() {
  if (!webllmEnginePromise) {
    webllmEnginePromise = createWebLLMEngine().catch((error) => {
      webllmEnginePromise = null;
      throw error;
    });
  }

  return webllmEnginePromise;
}

async function createWebLLMEngine() {
  try {
    return await CreateMLCEngine(
      WEBLLM_MODEL_ID,
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
        context_window_size: 2048
      }
    );
  } catch (error) {
    throw new Error(`WebLLM initialization failed: ${error.message}`);
  }
}

function getWebLLMAppConfig() {
  return {
    model_list: [
      {
        model: WEBLLM_MODEL_URL,
        model_id: WEBLLM_MODEL_ID,
        model_lib: chrome.runtime.getURL(WEBLLM_MODEL_LIB),
        low_resource_required: true,
        vram_required_MB: 1629.75,
        overrides: {
          context_window_size: 2048
        }
      }
    ]
  };
}

function buildAnalysisPrompt(ocrText) {
  return `You are QuizBuddy AI, a learning assistant.

The user has extracted the following OCR text from an image of a multiple-choice question.

Your task is to analyze the question and help the user learn.

OCR text:
"""
${ocrText}
"""

Return valid JSON only with this structure:
{
  "answerText": "The complete text or value of the best answer, or Unknown",
  "answerLabel": "The exact option label shown in OCR such as A, B, 1, or empty string",
  "confidence": "low/medium/high",
  "shortExplanation": "Briefly explain why the answer is correct.",
  "coreKnowledge": "The key concept, formula, grammar rule, or theory needed to solve the question.",
  "notes": "A short learning note to help the user avoid common mistakes."
}

Rules:
- Do not include markdown.
- Do not include extra text outside JSON.
- Always put the actual answer content in "answerText", not only a letter.
- Only set "answerLabel" when that exact label is visibly present before an option in the OCR text.
- Never invent A/B/C/D labels when the choices are unlabeled.
- If choices are unlabeled, return the full selected choice text and use an empty "answerLabel".
- For a calculated or open response, return the actual value or statement in "answerText".
- If the OCR text is unclear or incomplete, use "Unknown" and an empty "answerLabel".
- Write the answer and learning explanation in the same language as the question.
- Focus on learning explanation, not just the final answer.`;
}

function reportProgress(stage, text, progress) {
  if (!activeRequestId) {
    return;
  }

  chrome.runtime
    .sendMessage({
      type: "QB_PROCESS_PROGRESS",
      requestId: activeRequestId,
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
      ...payload
    })
    .catch(() => {});
}
