import extensionStyles from "./content.css";
import floatingIconUrl from "../assets/icon.png";
import {
  DEFAULT_MODEL_ID,
  DEFAULT_OCR_LANGUAGE,
  MODEL_PROFILES,
  OCR_LANGUAGE_OPTIONS,
  getModelProfile,
  normalizeOCRLanguage
} from "../lib/app-config.js";

(() => {
  if (window.__quizBuddyInjected) {
    return;
  }
  window.__quizBuddyInjected = true;

  let cropOverlay = null;
  let cropSelection = null;
  let startPoint = null;
  let isSelecting = false;
  let activeRequestId = null;
  let modelRequestId = null;
  let modelReady = false;
  let modelStatusChecked = false;
  let selectedModelCached = false;
  let selectedModelId = DEFAULT_MODEL_ID;
  let selectedOcrLanguage = DEFAULT_OCR_LANGUAGE;
  let preferencesLoadedPromise = null;

  const MODEL_SELECTION_KEY = "qbSelectedModelId";
  const OCR_LANGUAGE_KEY = "qbOcrLanguage";
  const host = document.createElement("div");
  host.id = "quizbuddy-ai-root";
  setProtectedHostStyles(host);

  const shadowRoot = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = extensionStyles;
  shadowRoot.append(style);

  const floatingButton = createElement("button", "qb-floating-button");
  floatingButton.type = "button";
  floatingButton.title = "Open QuizBuddy AI";
  floatingButton.setAttribute("aria-label", "Open QuizBuddy AI");
  const icon = document.createElement("img");
  icon.src = floatingIconUrl;
  icon.alt = "";
  icon.className = "qb-floating-icon";
  icon.setAttribute("aria-hidden", "true");
  floatingButton.append(icon);

  const sidebar = createElement("aside", "qb-sidebar");
  sidebar.setAttribute("aria-label", "QuizBuddy AI");
  sidebar.innerHTML = `
    <div class="qb-sidebar-header">
      <div>
        <div class="qb-title">QuizBuddy AI</div>
        <div class="qb-subtitle">Local question analysis</div>
      </div>
      <button class="qb-close-button" type="button" aria-label="Close sidebar">&times;</button>
    </div>
    <div class="qb-sidebar-body">
      <section class="qb-model-card">
        <div class="qb-model-card-title">Local AI Model</div>
        <label class="qb-field-label" for="qb-model-select">Model</label>
        <select id="qb-model-select" class="qb-select qb-model-select">
          ${MODEL_PROFILES.map(
            (profile) =>
              `<option value="${profile.id}">${profile.label} - Qwen2.5 ${profile.id.includes("0.5B") ? "0.5B" : "1.5B"}</option>`
          ).join("")}
        </select>
        <div class="qb-model-card-text">
          Checking local model status...
        </div>
        <div class="qb-model-storage-note">
          Model weights are stored in Chrome Cache Storage under
          <span class="qb-model-storage-origin"></span>, not in your Downloads folder.
        </div>
        <div class="qb-model-cache-summary"></div>
        <div class="qb-model-progress qb-hidden" aria-hidden="true">
          <div class="qb-model-progress-bar"></div>
        </div>
        <div class="qb-model-actions">
          <button class="qb-model-download-button" type="button">
            Download Local Model
          </button>
          <button class="qb-model-later-button" type="button">Not Now</button>
          <button class="qb-model-delete-button qb-hidden" type="button">
            Delete Cache
          </button>
        </div>
      </section>
      <section class="qb-settings-row">
        <label class="qb-field-label" for="qb-ocr-language">OCR Language</label>
        <select id="qb-ocr-language" class="qb-select qb-ocr-language">
          ${OCR_LANGUAGE_OPTIONS.map(
            (option) =>
              `<option value="${option.id}">${option.label}</option>`
          ).join("")}
        </select>
      </section>
      <button class="qb-crop-button" type="button">Crop Question</button>
      <div class="qb-status" role="status">Ready to crop a question.</div>
      <section class="qb-section qb-preview-section qb-hidden">
        <h2 class="qb-section-title">Cropped Image</h2>
        <img class="qb-preview-image" alt="Cropped question" />
      </section>
      <section class="qb-section qb-ocr-section qb-hidden">
        <h2 class="qb-section-title">OCR Text</h2>
        <textarea class="qb-ocr-textarea" rows="8" spellcheck="true"></textarea>
        <button class="qb-analyze-button" type="button">Analyze Again</button>
      </section>
      <section class="qb-section qb-result-section qb-hidden">
        <h2 class="qb-section-title">AI Result</h2>
        <div class="qb-result-card"></div>
      </section>
      <section class="qb-error-card qb-hidden" role="alert"></section>
    </div>
  `;

  shadowRoot.append(floatingButton, sidebar);
  document.documentElement.append(host);

  const closeButton = sidebar.querySelector(".qb-close-button");
  const modelCard = sidebar.querySelector(".qb-model-card");
  const modelCardTitle = sidebar.querySelector(".qb-model-card-title");
  const modelCardText = sidebar.querySelector(".qb-model-card-text");
  const modelStorageOrigin = sidebar.querySelector(
    ".qb-model-storage-origin"
  );
  const modelCacheSummary = sidebar.querySelector(".qb-model-cache-summary");
  const modelSelect = sidebar.querySelector(".qb-model-select");
  const modelProgress = sidebar.querySelector(".qb-model-progress");
  const modelProgressBar = sidebar.querySelector(".qb-model-progress-bar");
  const modelActions = sidebar.querySelector(".qb-model-actions");
  const modelDownloadButton = sidebar.querySelector(
    ".qb-model-download-button"
  );
  const modelLaterButton = sidebar.querySelector(".qb-model-later-button");
  const modelDeleteButton = sidebar.querySelector(".qb-model-delete-button");
  const ocrLanguageSelect = sidebar.querySelector(".qb-ocr-language");
  const cropButton = sidebar.querySelector(".qb-crop-button");
  const status = sidebar.querySelector(".qb-status");
  const previewSection = sidebar.querySelector(".qb-preview-section");
  const previewImage = sidebar.querySelector(".qb-preview-image");
  const ocrSection = sidebar.querySelector(".qb-ocr-section");
  const ocrTextarea = sidebar.querySelector(".qb-ocr-textarea");
  const analyzeButton = sidebar.querySelector(".qb-analyze-button");
  const resultSection = sidebar.querySelector(".qb-result-section");
  const resultCard = sidebar.querySelector(".qb-result-card");
  const errorCard = sidebar.querySelector(".qb-error-card");

  cropButton.disabled = true;
  analyzeButton.disabled = true;
  modelStorageOrigin.textContent = `chrome-extension://${chrome.runtime.id}`;

  floatingButton.addEventListener("click", async () => {
    const willOpen = !sidebar.classList.contains("qb-sidebar-open");
    sidebar.classList.toggle("qb-sidebar-open");
    if (willOpen) {
      await ensureModelOnboarding();
    }
  });

  closeButton.addEventListener("click", () => {
    sidebar.classList.remove("qb-sidebar-open");
  });

  cropButton.addEventListener("click", startCropMode);
  analyzeButton.addEventListener("click", analyzeEditedOCRText);
  modelDownloadButton.addEventListener("click", () => {
    prepareLocalModel();
  });
  modelLaterButton.addEventListener("click", postponeModelDownload);
  modelDeleteButton.addEventListener("click", deleteSelectedModel);
  modelSelect.addEventListener("change", onModelSelectionChange);
  ocrLanguageSelect.addEventListener("change", onOCRLanguageChange);

  chrome.runtime.onMessage.addListener(message => {
    if (message.type === "QB_OPEN_SIDEBAR") {
      sidebar.classList.add("qb-sidebar-open");
      ensureModelOnboarding();
    }

    if (message.type === "QB_START_CROP") {
      sidebar.classList.add("qb-sidebar-open");
      startCropFromShortcut();
    }

    if (message.type === "QB_CAPTURE_FINISHED") {
      setCaptureVisibility(false);
      setStatus(
        "Processing locally. The first run may take longer because the model needs to initialize.",
        true
      );
    }

    if (
      message.type === "QB_PROCESS_PROGRESS" &&
      (message.requestId === activeRequestId ||
        message.requestId === modelRequestId)
    ) {
      if (message.requestId === modelRequestId) {
        updateModelProgress(message);
      } else {
        setStatus(
          message.text || "Processing locally...",
          message.stage !== "done"
        );
      }
    }

    if (
      message.type === "QB_PROCESS_PARTIAL" &&
      message.requestId === activeRequestId
    ) {
      renderPartialResult(message);
    }
  });

  async function startCropFromShortcut() {
    await ensureModelOnboarding();
    if (modelReady) {
      startCropMode();
    }
  }

  function startCropMode() {
    if (!modelReady) {
      showError(
        "Download and prepare the local AI model before cropping a question."
      );
      setStatus("Local AI model is not ready.");
      return;
    }

    if (cropOverlay) {
      return;
    }

    sidebar.classList.remove("qb-sidebar-open");
    clearError();
    setStatus("Drag to select the question area.");

    cropOverlay = createElement("div", "qb-crop-overlay");
    cropSelection = createElement("div", "qb-crop-selection");
    cropSelection.classList.add("qb-hidden");
    cropOverlay.append(cropSelection);
    shadowRoot.append(cropOverlay);

    cropOverlay.addEventListener("mousedown", onCropMouseDown);
    cropOverlay.addEventListener("mousemove", onCropMouseMove);
    cropOverlay.addEventListener("mouseup", onCropMouseUp);
    window.addEventListener("keydown", onCropKeyDown, true);
  }

  function onCropMouseDown(event) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    startPoint = { x: event.clientX, y: event.clientY };
    isSelecting = true;
    cropSelection.classList.remove("qb-hidden");
    updateSelection(startPoint.x, startPoint.y, 0, 0);
  }

  function onCropMouseMove(event) {
    if (!isSelecting || !startPoint) {
      return;
    }

    const rect = normalizeRect(
      startPoint.x,
      startPoint.y,
      event.clientX,
      event.clientY
    );
    updateSelection(rect.x, rect.y, rect.width, rect.height);
  }

  async function onCropMouseUp(event) {
    if (!isSelecting || !startPoint) {
      return;
    }

    isSelecting = false;
    const rect = normalizeRect(
      startPoint.x,
      startPoint.y,
      event.clientX,
      event.clientY
    );
    removeCropOverlay();
    sidebar.classList.add("qb-sidebar-open");

    if (rect.width < 30 || rect.height < 30) {
      showError(
        "The crop area is too small. Select an area at least 30 × 30 pixels."
      );
      setStatus("Crop area is too small.");
      return;
    }

    resetOutput();
    setStatus("Capturing screenshot...", true);
    setProcessingState(true);
    setCaptureVisibility(true);
    await waitForBrowserPaint();
    activeRequestId = crypto.randomUUID();

    try {
      const response = await chrome.runtime.sendMessage({
        type: "QB_CAPTURE_PROCESS_LOCAL",
        requestId: activeRequestId,
        modelId: selectedModelId,
        ocrLanguage: selectedOcrLanguage,
        rect: {
          ...rect,
          devicePixelRatio: window.devicePixelRatio || 1,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        },
      });

      setCaptureVisibility(false);
      handleProcessingResponse(response);
    } catch (error) {
      setCaptureVisibility(false);
      showError(
        `Could not process the question: ${error.message || "Unknown extension error."}`
      );
      setStatus("Processing failed.");
    } finally {
      activeRequestId = null;
      setProcessingState(false);
    }
  }

  function onCropKeyDown(event) {
    if (event.key !== "Escape") {
      return;
    }

    event.preventDefault();
    removeCropOverlay();
    sidebar.classList.add("qb-sidebar-open");
    setStatus("Crop cancelled.");
  }

  function removeCropOverlay() {
    cropOverlay?.remove();
    cropOverlay = null;
    cropSelection = null;
    startPoint = null;
    isSelecting = false;
    window.removeEventListener("keydown", onCropKeyDown, true);
  }

  function handleProcessingResponse(response) {
    if (!response) {
      showError("No response was received from the extension.");
      setStatus("Processing failed.");
      return;
    }

    renderPartialResult(response);

    if (!response.ok) {
      showError(response.error || "Local processing failed.");
      setStatus(
        response.stage === "ocr"
          ? "OCR failed."
          : response.stage === "webllm"
            ? "Local AI analysis failed."
            : "Processing failed."
      );
      return;
    }

    renderAIResult(response.aiResult);
    setStatus("Done.");
  }

  function renderPartialResult(result) {
    if (result.croppedImageDataUrl) {
      previewImage.src = result.croppedImageDataUrl;
      previewSection.classList.remove("qb-hidden");
    }

    if (result.ocrText) {
      ocrTextarea.value = result.ocrText;
      ocrSection.classList.remove("qb-hidden");
    }
  }

  function renderAIResult(result) {
    const suggestedAnswer = result.answerLabel
      ? `${result.answerLabel}. ${result.answerText}`
      : result.answerText;

    resultCard.replaceChildren(
      createResultItem("Suggested Answer", suggestedAnswer, "qb-answer"),
      createResultItem("Confidence", result.confidence),
      createResultItem("Explanation", result.shortExplanation),
      createResultItem("Core Knowledge", result.coreKnowledge),
      createResultItem("Study Note", result.notes)
    );
    resultSection.classList.remove("qb-hidden");
  }

  function createResultItem(label, value, valueClass = "") {
    const item = createElement("div", "qb-result-item");
    const labelElement = createElement("div", "qb-result-label", label);
    const valueElement = createElement(
      "div",
      `qb-result-value ${valueClass}`.trim(),
      value || "Not provided"
    );
    item.append(labelElement, valueElement);
    return item;
  }

  function resetOutput() {
    clearError();
    previewImage.removeAttribute("src");
    ocrTextarea.value = "";
    resultCard.replaceChildren();
    previewSection.classList.add("qb-hidden");
    ocrSection.classList.add("qb-hidden");
    resultSection.classList.add("qb-hidden");
  }

  function setStatus(message, loading = false) {
    status.textContent = message;
    status.classList.toggle("qb-status-loading", loading);
  }

  function showError(message) {
    errorCard.textContent = message;
    errorCard.classList.remove("qb-hidden");
  }

  function clearError() {
    errorCard.textContent = "";
    errorCard.classList.add("qb-hidden");
  }

  function setCaptureVisibility(hidden) {
    floatingButton.classList.toggle("qb-capture-hidden", hidden);
    sidebar.classList.toggle("qb-capture-hidden", hidden);
  }

  function setProcessingState(processing) {
    cropButton.disabled = processing || !modelReady;
    cropButton.textContent = processing ? "Processing..." : "Crop Question";
    analyzeButton.disabled = processing || !modelReady;
    analyzeButton.textContent = processing ? "Analyzing..." : "Analyze Again";
    modelSelect.disabled = processing || Boolean(modelRequestId);
    ocrLanguageSelect.disabled = processing;
  }

  async function ensureModelOnboarding() {
    await loadPreferences();
    if (modelReady || modelRequestId) {
      return;
    }

    modelCard.classList.remove("qb-hidden");
    if (modelStatusChecked) {
      return;
    }

    modelStatusChecked = true;
    setModelCardState("checking");

    try {
      const response = await chrome.runtime.sendMessage({
        type: "QB_GET_MODEL_STATUS",
        modelId: selectedModelId
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Could not check model status.");
      }

      renderModelCacheSummary(response.models);
      selectedModelCached = Boolean(response.cached);

      if (!response.webgpuAvailable) {
        setModelCardState(
          "error",
          "WebGPU is unavailable. Enable hardware acceleration and restart Chrome/Edge."
        );
        return;
      }

      if (response.cached) {
        setModelCardState("cached");
        return;
      }

      setModelCardState("permission");
    } catch (error) {
      modelStatusChecked = false;
      setModelCardState("error", error.message);
    }
  }

  async function prepareLocalModel() {
    clearError();
    modelRequestId = crypto.randomUUID();
    setModelCardState("downloading");
    setProcessingState(true);

    try {
      const response = await chrome.runtime.sendMessage({
        type: "QB_PREPARE_MODEL",
        requestId: modelRequestId,
        modelId: selectedModelId
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Local model setup failed.");
      }

      setModelReady();
      await refreshModelStatusSummary();
    } catch (error) {
      setModelCardState("error", error.message);
      showError(`Local model setup failed: ${error.message}`);
    } finally {
      modelRequestId = null;
      setProcessingState(false);
    }
  }

  async function postponeModelDownload() {
    setModelCardState("postponed");
    setStatus("Model download postponed. Crop is disabled.");
  }

  function updateModelProgress(message) {
    const progress = Math.max(0, Math.min(1, Number(message.progress) || 0));
    modelProgressBar.style.width = `${Math.round(progress * 100)}%`;
    modelCardText.textContent =
      message.text || "Downloading and preparing the local model...";
    setStatus(message.text || "Preparing local AI model...", true);

    if (message.stage === "model-ready") {
      setModelReady();
    }
  }

  function setModelReady() {
    modelReady = true;
    modelStatusChecked = true;
    cropButton.disabled = false;
    const profile = getModelProfile(selectedModelId);
    modelCardTitle.textContent = `${profile.label} Model Ready`;
    modelCardText.textContent = `${profile.description} Inference stays in this browser.`;
    modelProgressBar.style.width = "100%";
    modelProgress.classList.remove("qb-hidden");
    modelActions.classList.remove("qb-hidden");
    modelDownloadButton.classList.add("qb-hidden");
    modelLaterButton.classList.add("qb-hidden");
    modelDeleteButton.classList.remove("qb-hidden");
    modelCard.classList.add("qb-model-card-ready");
    setStatus("Ready to crop a question.");
  }

  function setModelCardState(state, detail = "") {
    modelCard.classList.remove("qb-model-card-ready");
    modelProgress.classList.add("qb-hidden");
    modelActions.classList.remove("qb-hidden");
    modelDownloadButton.disabled = false;
    modelLaterButton.disabled = false;
    modelDeleteButton.disabled = false;
    modelDownloadButton.classList.remove("qb-hidden");
    modelDeleteButton.classList.add("qb-hidden");
    modelLaterButton.classList.remove("qb-hidden");

    if (state === "checking") {
      modelCardTitle.textContent = "Checking Local AI Model";
      modelCardText.textContent =
        "Checking whether the model is already cached...";
      modelActions.classList.add("qb-hidden");
      return;
    }

    if (state === "downloading") {
      modelCardTitle.textContent = selectedModelCached
        ? "Loading Cached Model"
        : "Downloading Selected Model";
      modelCardText.textContent = selectedModelCached
        ? "Loading the selected cached model into WebGPU..."
        : "Downloading the model you selected. Keep this browser open...";
      modelProgressBar.style.width = "0%";
      modelProgress.classList.remove("qb-hidden");
      modelDownloadButton.disabled = true;
      modelLaterButton.disabled = true;
      return;
    }

    if (state === "cached") {
      const profile = getModelProfile(selectedModelId);
      modelCardTitle.textContent = `${profile.label} Model Is Cached`;
      modelCardText.textContent =
        "The model is already stored by Chrome. Click below to load it into WebGPU for this session.";
      modelDownloadButton.textContent = "Use Cached Model";
      modelLaterButton.classList.add("qb-hidden");
      modelDeleteButton.classList.remove("qb-hidden");
      return;
    }

    if (state === "postponed") {
      modelCardTitle.textContent = "Local Model Not Downloaded";
      modelCardText.textContent =
        "QuizBuddy AI needs the local model before it can analyze cropped questions.";
      modelDownloadButton.textContent = "Download Local Model";
      modelLaterButton.classList.add("qb-hidden");
      return;
    }

    if (state === "error") {
      modelCardTitle.textContent = "Model Setup Unavailable";
      modelCardText.textContent =
        detail ||
        "Could not prepare the local model. Check WebGPU and network access.";
      modelDownloadButton.textContent = "Try Again";
      modelLaterButton.textContent = "Not Now";
      return;
    }

    const profile = getModelProfile(selectedModelId);
    modelCardTitle.textContent = "Download Local AI Model?";
    modelCardText.textContent =
      `${profile.label}: ${profile.description} Requires about ${formatMemory(profile.vramRequiredMB)} of GPU memory. Nothing is downloaded until you click the button below.`;
    modelDownloadButton.textContent = `Download ${profile.label} Model`;
    modelLaterButton.textContent = "Not Now";
    modelLaterButton.classList.remove("qb-hidden");
  }

  async function loadPreferences() {
    if (!preferencesLoadedPromise) {
      preferencesLoadedPromise = chrome.storage.local
        .get([MODEL_SELECTION_KEY, OCR_LANGUAGE_KEY])
        .then((storage) => {
          selectedModelId = getModelProfile(
            storage[MODEL_SELECTION_KEY]
          ).id;
          selectedOcrLanguage = normalizeOCRLanguage(
            storage[OCR_LANGUAGE_KEY]
          );
          modelSelect.value = selectedModelId;
          ocrLanguageSelect.value = selectedOcrLanguage;
        });
    }

    return preferencesLoadedPromise;
  }

  async function onModelSelectionChange() {
    selectedModelId = getModelProfile(modelSelect.value).id;
    await chrome.storage.local.set({
      [MODEL_SELECTION_KEY]: selectedModelId
    });
    modelReady = false;
    modelStatusChecked = false;
    selectedModelCached = false;
    cropButton.disabled = true;
    clearError();
    await ensureModelOnboarding();
  }

  async function onOCRLanguageChange() {
    selectedOcrLanguage = normalizeOCRLanguage(ocrLanguageSelect.value);
    await chrome.storage.local.set({
      [OCR_LANGUAGE_KEY]: selectedOcrLanguage
    });
  }

  async function deleteSelectedModel() {
    const profile = getModelProfile(selectedModelId);
    if (
      !window.confirm(
        `Delete the cached ${profile.label} model weights from this browser?`
      )
    ) {
      return;
    }

    modelRequestId = crypto.randomUUID();
    setProcessingState(true);
    clearError();
    setStatus(`Deleting ${profile.label} model cache...`, true);

    try {
      const response = await chrome.runtime.sendMessage({
        type: "QB_DELETE_MODEL",
        requestId: modelRequestId,
        modelId: selectedModelId
      });
      if (!response?.ok) {
        throw new Error(response?.error || "Could not delete model cache.");
      }

      modelReady = false;
      modelStatusChecked = false;
      selectedModelCached = false;
      setModelCardState("postponed");
      setStatus(`${profile.label} model cache deleted.`);
      await refreshModelStatusSummary();
    } catch (error) {
      showError(`Could not delete model cache: ${error.message}`);
      setStatus("Model cache deletion failed.");
    } finally {
      modelRequestId = null;
      setProcessingState(false);
    }
  }

  async function analyzeEditedOCRText() {
    const editedText = ocrTextarea.value.trim();
    if (editedText.length < 8) {
      showError(
        "OCR text is too short. Enter the complete question before analyzing again."
      );
      return;
    }

    if (!modelReady || activeRequestId) {
      showError("The local model is not ready or another task is running.");
      return;
    }

    activeRequestId = crypto.randomUUID();
    clearError();
    resultSection.classList.add("qb-hidden");
    resultCard.replaceChildren();
    setProcessingState(true);
    setStatus("Analyzing edited text locally...", true);

    try {
      const response = await chrome.runtime.sendMessage({
        type: "QB_ANALYZE_TEXT_LOCAL",
        requestId: activeRequestId,
        modelId: selectedModelId,
        ocrText: editedText
      });
      handleProcessingResponse(response);
    } catch (error) {
      showError(`Could not analyze edited text: ${error.message}`);
      setStatus("Local AI analysis failed.");
    } finally {
      activeRequestId = null;
      setProcessingState(false);
    }
  }

  function renderModelCacheSummary(models = []) {
    modelCacheSummary.replaceChildren(
      ...models.map((model) => {
        const row = createElement("div", "qb-model-cache-row");
        row.append(
          createElement("span", "", model.label),
          createElement(
            "span",
            model.cached ? "qb-cache-ready" : "qb-cache-missing",
            model.cached ? "Cached" : "Not downloaded"
          )
        );
        return row;
      })
    );
  }

  async function refreshModelStatusSummary() {
    const response = await chrome.runtime.sendMessage({
      type: "QB_GET_MODEL_STATUS",
      modelId: selectedModelId
    });
    if (response?.ok) {
      renderModelCacheSummary(response.models);
    }
  }

  function formatMemory(memoryMB) {
    return memoryMB >= 1024
      ? `${(memoryMB / 1024).toFixed(2)} GB`
      : `${Math.round(memoryMB)} MB`;
  }

  function waitForBrowserPaint() {
    return new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }

  function normalizeRect(startX, startY, endX, endY) {
    return {
      x: Math.min(startX, endX),
      y: Math.min(startY, endY),
      width: Math.abs(endX - startX),
      height: Math.abs(endY - startY),
    };
  }

  function updateSelection(x, y, width, height) {
    Object.assign(cropSelection.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
  }

  function createElement(tagName, className, text = "") {
    const element = document.createElement(tagName);
    element.className = className;
    if (text) {
      element.textContent = text;
    }
    return element;
  }

  function setProtectedHostStyles(element) {
    const styles = {
      all: "initial",
      contain: "none",
      display: "block",
      height: "0",
      isolation: "isolate",
      left: "0",
      margin: "0",
      opacity: "1",
      overflow: "visible",
      padding: "0",
      "pointer-events": "none",
      position: "fixed",
      top: "0",
      transform: "none",
      visibility: "visible",
      width: "0",
      "z-index": "2147483647",
    };

    for (const [property, value] of Object.entries(styles)) {
      element.style.setProperty(property, value, "important");
    }
  }
})();
