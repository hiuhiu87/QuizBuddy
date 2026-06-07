import extensionStyles from "./content.css";
import floatingIconUrl from "../assets/icon.png";
import {
  ANALYSIS_MODES,
  DEFAULT_ANALYSIS_MODE,
  DEFAULT_MODEL_ID,
  DEFAULT_OCR_LANGUAGE,
  DEFAULT_SUBJECT_PRESET,
  MODEL_PROFILES,
  OCR_LANGUAGE_OPTIONS,
  SUBJECT_PRESETS,
  getModelProfile,
  getSubjectPreset,
  normalizeAnalysisMode,
  normalizeOCRLanguage,
  normalizeSubjectPreset
} from "../lib/app-config.js";
import {
  addSessionStudyNote,
  clearSessionStudyNotes
} from "../lib/study-notes.js";
import { evaluatePracticeAnswer } from "../lib/practice-utils.js";

(() => {
  const injectionFlag = Symbol.for("qb.content.injected");
  if (globalThis[injectionFlag]) {
    return;
  }
  Object.defineProperty(globalThis, injectionFlag, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false
  });

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
  let selectedAnalysisMode = DEFAULT_ANALYSIS_MODE;
  let selectedSubject = DEFAULT_SUBJECT_PRESET;
  let sessionStudyNotes = [];
  let lastAnalysisContext = null;
  let lastScreenshotAvailable = false;
  let floatingButtonDocked = false;
  let floatingPointerStart = null;
  let floatingButtonDragged = false;
  let suppressFloatingClick = false;
  let preferencesLoadedPromise = null;
  let resourceReleaseTimer = null;

  const MODEL_SELECTION_KEY = "qbSelectedModelId";
  const OCR_LANGUAGE_KEY = "qbOcrLanguage";
  const FLOATING_BUTTON_DOCKED_KEY = "qbFloatingButtonDocked";
  const ANALYSIS_MODE_KEY = "qbAnalysisMode";
  const SUBJECT_PRESET_KEY = "qbSubjectPreset";
  const host = document.createElement("div");
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
  const dockHandle = createElement("span", "qb-floating-dock-handle", "‹");
  dockHandle.setAttribute("aria-hidden", "true");
  floatingButton.append(icon, dockHandle);

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
              `<option value="${profile.id}">${profile.label} - Qwen2.5 ${profile.parameterLabel}</option>`
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
        <details class="qb-diagnostics">
          <summary>Device Check</summary>
          <div class="qb-diagnostics-content">Checking device...</div>
        </details>
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
        <label class="qb-field-label" for="qb-subject-preset">Subject</label>
        <select id="qb-subject-preset" class="qb-select qb-subject-preset">
          ${SUBJECT_PRESETS.map(
            (option) =>
              `<option value="${option.id}">${option.label}</option>`
          ).join("")}
        </select>
        <div class="qb-field-label">Mode</div>
        <div class="qb-mode-selector" role="group" aria-label="Analysis mode">
          ${ANALYSIS_MODES.map(
            (option) =>
              `<button type="button" class="qb-mode-button" data-mode="${option.id}">${option.label}</button>`
          ).join("")}
        </div>
        <label class="qb-check-answer-toggle">
          <input class="qb-check-answer-checkbox" type="checkbox" />
          <span>Check my answer instead of just solving</span>
        </label>
        <input
          class="qb-user-answer-input qb-hidden"
          type="text"
          placeholder="I think the answer is... (A, B, or free text)"
          aria-label="Your answer"
        />
      </section>
      <button class="qb-crop-button" type="button">Crop Question</button>
      <div class="qb-status" role="status">Ready to crop a question.</div>
      <section class="qb-section qb-preview-section qb-hidden">
        <h2 class="qb-section-title">Cropped Image</h2>
        <img class="qb-preview-image" alt="Cropped question" />
        <button class="qb-recrop-button" type="button" disabled>
          Re-crop screenshot
        </button>
      </section>
      <section class="qb-section qb-ocr-section qb-hidden">
        <h2 class="qb-section-title">OCR Text</h2>
        <div class="qb-ocr-confidence"></div>
        <textarea class="qb-ocr-textarea" rows="8" spellcheck="true"></textarea>
        <button class="qb-analyze-button" type="button">Analyze Again</button>
      </section>
      <section class="qb-section qb-result-section qb-hidden">
        <h2 class="qb-section-title">AI Result</h2>
        <div class="qb-result-card"></div>
      </section>
      <section class="qb-section qb-practice-section qb-hidden">
        <h2 class="qb-section-title">Similar Practice</h2>
        <div class="qb-practice-card"></div>
      </section>
      <section class="qb-section qb-notes-section qb-hidden">
        <div class="qb-section-heading-row">
          <h2 class="qb-section-title">Today's Concepts</h2>
          <button class="qb-clear-notes-button" type="button">Clear</button>
        </div>
        <div class="qb-notes-list"></div>
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
  const diagnosticsContent = sidebar.querySelector(
    ".qb-diagnostics-content"
  );
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
  const subjectSelect = sidebar.querySelector(".qb-subject-preset");
  const modeButtons = [...sidebar.querySelectorAll(".qb-mode-button")];
  const checkAnswerCheckbox = sidebar.querySelector(
    ".qb-check-answer-checkbox"
  );
  const userAnswerInput = sidebar.querySelector(".qb-user-answer-input");
  const cropButton = sidebar.querySelector(".qb-crop-button");
  const status = sidebar.querySelector(".qb-status");
  const previewSection = sidebar.querySelector(".qb-preview-section");
  const previewImage = sidebar.querySelector(".qb-preview-image");
  const recropButton = sidebar.querySelector(".qb-recrop-button");
  const ocrSection = sidebar.querySelector(".qb-ocr-section");
  const ocrConfidence = sidebar.querySelector(".qb-ocr-confidence");
  const ocrTextarea = sidebar.querySelector(".qb-ocr-textarea");
  const analyzeButton = sidebar.querySelector(".qb-analyze-button");
  const resultSection = sidebar.querySelector(".qb-result-section");
  const resultCard = sidebar.querySelector(".qb-result-card");
  const errorCard = sidebar.querySelector(".qb-error-card");
  const practiceSection = sidebar.querySelector(".qb-practice-section");
  const practiceCard = sidebar.querySelector(".qb-practice-card");
  const notesSection = sidebar.querySelector(".qb-notes-section");
  const notesList = sidebar.querySelector(".qb-notes-list");
  const clearNotesButton = sidebar.querySelector(".qb-clear-notes-button");

  cropButton.disabled = true;
  analyzeButton.disabled = true;
  modelStorageOrigin.textContent = `chrome-extension://${chrome.runtime.id}`;

  floatingButton.addEventListener("click", async () => {
    if (suppressFloatingClick) {
      suppressFloatingClick = false;
      return;
    }

    if (floatingButtonDocked) {
      await setFloatingButtonDocked(false);
      return;
    }

    const willOpen = !sidebar.classList.contains("qb-sidebar-open");
    sidebar.classList.toggle("qb-sidebar-open");
    if (willOpen) {
      await ensureModelOnboarding();
    } else {
      releaseLocalResources();
    }
  });

  closeButton.addEventListener("click", () => {
    sidebar.classList.remove("qb-sidebar-open");
    releaseLocalResources();
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
  subjectSelect.addEventListener("change", onSubjectChange);
  modeButtons.forEach((button) =>
    button.addEventListener("click", () => setAnalysisMode(button.dataset.mode))
  );
  checkAnswerCheckbox.addEventListener("change", () => {
    userAnswerInput.classList.toggle(
      "qb-hidden",
      !checkAnswerCheckbox.checked
    );
    if (checkAnswerCheckbox.checked) {
      userAnswerInput.focus();
    }
  });
  recropButton.addEventListener("click", openRecropModal);
  clearNotesButton.addEventListener("click", () => {
    sessionStudyNotes = clearSessionStudyNotes();
    renderSessionStudyNotes();
  });
  floatingButton.addEventListener("pointerdown", onFloatingPointerDown);
  floatingButton.addEventListener("pointermove", onFloatingPointerMove);
  floatingButton.addEventListener("pointerup", onFloatingPointerUp);
  floatingButton.addEventListener("pointercancel", resetFloatingPointer);
  window.addEventListener("pagehide", releaseLocalResources);
  loadPreferences().catch(() => {});

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

    cancelScheduledResourceRelease();
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
        mode: selectedAnalysisMode,
        subject: selectedSubject,
        userSelectedAnswer: getUserSelectedAnswer(),
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
      scheduleResourceRelease();
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
    if (response.croppedImageDataUrl) {
      lastScreenshotAvailable = true;
      recropButton.disabled = false;
    }

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
    lastAnalysisContext = {
      ocrText: response.ocrText || ocrTextarea.value,
      aiResult: response.aiResult
    };
    sessionStudyNotes = addSessionStudyNote(
      sessionStudyNotes,
      response.aiResult.coreKnowledge
    );
    renderSessionStudyNotes();
    lastScreenshotAvailable =
      lastScreenshotAvailable || Boolean(response.croppedImageDataUrl);
    recropButton.disabled = !lastScreenshotAvailable;
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

    if (Number.isFinite(result.ocrConfidence)) {
      const confidence = Math.round(result.ocrConfidence);
      ocrConfidence.textContent = `OCR confidence: ${confidence}%${
        confidence < 80 ? " - review the text before trusting the answer." : ""
      }`;
      ocrConfidence.classList.toggle("qb-ocr-confidence-low", confidence < 80);
    }
  }

  function renderAIResult(result) {
    const suggestedAnswer = result.answerLabel
      ? `${result.answerLabel}. ${result.answerText}`
      : result.answerText;

    const reliability = result.overallReliability || {
      level: "low",
      reasons: ["Reliability details are unavailable."]
    };
    const items = [
      createResultItem("Answer", suggestedAnswer, "qb-answer"),
      createResultItem("AI Confidence", result.confidence),
      createResultItem("Overall Reliability", reliability.level),
      createResultItem(
        "Reliability Reasons",
        reliability.reasons.join("\n")
      ),
      createResultItem(
        "Local Model",
        getModelProfile(selectedModelId).label
      ),
      createResultItem("Subject", getSubjectPreset(selectedSubject).label),
      createResultItem("Why this answer?", result.shortExplanation)
    ];

    if (result.userAnswerEvaluation) {
      items.push(createUserAnswerEvaluation(result.userAnswerEvaluation));
    }

    if (selectedAnalysisMode === "learning") {
      if (result.optionAnalysis?.length) {
        items.push(createOptionAnalysis(result.optionAnalysis));
      }
      items.push(
        createResultItem("Core Knowledge", result.coreKnowledge),
        createResultItem("Study Note", result.notes)
      );
      if (result.miniExample) {
        items.push(createMiniExample(result.miniExample));
      }
      if (result.coreKnowledge) {
        const practiceButton = createElement(
          "button",
          "qb-practice-button",
          "Practice Similar Question"
        );
        practiceButton.type = "button";
        practiceButton.addEventListener("click", generatePracticeQuestion);
        items.push(practiceButton);
      }
    }

    resultCard.replaceChildren(...items);
    resultSection.classList.remove("qb-hidden");
  }

  function createOptionAnalysis(options) {
    const details = createElement("details", "qb-result-details");
    const summary = createElement(
      "summary",
      "qb-result-details-summary",
      "Option Analysis"
    );
    const list = createElement("div", "qb-option-list");
    options.forEach((option) => {
      const item = createElement(
        "div",
        `qb-option-item ${
          option.isCorrect ? "qb-option-correct" : "qb-option-wrong"
        }`
      );
      const title = createElement(
        "div",
        "qb-option-title",
        `${option.isCorrect ? "Correct" : "Not selected"}: ${
          option.label ? `${option.label}. ` : ""
        }${option.text}`
      );
      item.append(title, createElement("div", "qb-option-reason", option.reason));
      list.append(item);
    });
    details.append(summary, list);
    return details;
  }

  function createMiniExample(example) {
    const details = createElement("details", "qb-result-details");
    details.append(
      createElement(
        "summary",
        "qb-result-details-summary",
        "Mini Example"
      ),
      createResultItem("Question", example.question),
      createResultItem("Answer", example.answer),
      createResultItem("Explanation", example.explanation)
    );
    return details;
  }

  function createUserAnswerEvaluation(evaluation) {
    const item = createElement(
      "div",
      `qb-user-evaluation ${
        evaluation.isCorrect
          ? "qb-user-evaluation-correct"
          : "qb-user-evaluation-wrong"
      }`
    );
    item.append(
      createResultItem("Your Answer", evaluation.userAnswer),
      createResultItem(
        "Result",
        evaluation.isCorrect ? "Correct" : "Not quite"
      ),
      createResultItem("Feedback", evaluation.feedback)
    );
    if (evaluation.mistakePattern) {
      item.append(
        createResultItem("Mistake Pattern", evaluation.mistakePattern)
      );
    }
    if (evaluation.howToAvoidNextTime) {
      item.append(
        createResultItem(
          "How To Avoid Next Time",
          evaluation.howToAvoidNextTime
        )
      );
    }
    return item;
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
    ocrConfidence.textContent = "";
    ocrConfidence.classList.remove("qb-ocr-confidence-low");
    resultCard.replaceChildren();
    practiceCard.replaceChildren();
    previewSection.classList.add("qb-hidden");
    ocrSection.classList.add("qb-hidden");
    resultSection.classList.add("qb-hidden");
    practiceSection.classList.add("qb-hidden");
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
    subjectSelect.disabled = processing;
    modeButtons.forEach((button) => {
      button.disabled = processing;
    });
    recropButton.disabled = processing || !lastScreenshotAvailable;
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
      renderDeviceDiagnostics(response.diagnostics);
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
    cancelScheduledResourceRelease();
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
      await refreshModelStatusSummary().catch(() => {});
    } finally {
      modelRequestId = null;
      setProcessingState(false);
      scheduleResourceRelease(30000);
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
        `${profile.description} The model is already stored by Chrome. Click below to load it into WebGPU for this session.`;
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
        .get([
          MODEL_SELECTION_KEY,
          OCR_LANGUAGE_KEY,
          FLOATING_BUTTON_DOCKED_KEY,
          ANALYSIS_MODE_KEY,
          SUBJECT_PRESET_KEY
        ])
        .then((storage) => {
          selectedModelId = getModelProfile(
            storage[MODEL_SELECTION_KEY]
          ).id;
          selectedOcrLanguage = normalizeOCRLanguage(
            storage[OCR_LANGUAGE_KEY]
          );
          selectedAnalysisMode = normalizeAnalysisMode(
            storage[ANALYSIS_MODE_KEY]
          );
          selectedSubject = normalizeSubjectPreset(
            storage[SUBJECT_PRESET_KEY]
          );
          floatingButtonDocked =
            storage[FLOATING_BUTTON_DOCKED_KEY] === true;
          modelSelect.value = selectedModelId;
          ocrLanguageSelect.value = selectedOcrLanguage;
          subjectSelect.value = selectedSubject;
          applyAnalysisMode();
          applyFloatingButtonDockState();
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

  async function onSubjectChange() {
    selectedSubject = normalizeSubjectPreset(subjectSelect.value);
    await chrome.storage.local.set({
      [SUBJECT_PRESET_KEY]: selectedSubject
    });
  }

  async function setAnalysisMode(mode) {
    selectedAnalysisMode = normalizeAnalysisMode(mode);
    applyAnalysisMode();
    await chrome.storage.local.set({
      [ANALYSIS_MODE_KEY]: selectedAnalysisMode
    });
  }

  function applyAnalysisMode() {
    modeButtons.forEach((button) => {
      const selected = button.dataset.mode === selectedAnalysisMode;
      button.classList.toggle("qb-mode-button-active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  async function setFloatingButtonDocked(docked) {
    floatingButtonDocked = Boolean(docked);
    applyFloatingButtonDockState();
    await chrome.storage.local.set({
      [FLOATING_BUTTON_DOCKED_KEY]: floatingButtonDocked
    });
  }

  function applyFloatingButtonDockState() {
    floatingButton.classList.toggle("qb-floating-docked", floatingButtonDocked);
    floatingButton.title = floatingButtonDocked
      ? "Expand QuizBuddy AI button"
      : "Open QuizBuddy AI";
    floatingButton.setAttribute(
      "aria-label",
      floatingButtonDocked
        ? "Expand QuizBuddy AI button"
        : "Open QuizBuddy AI"
    );
  }

  function onFloatingPointerDown(event) {
    if (event.button !== 0 || floatingButtonDocked) {
      return;
    }

    floatingPointerStart = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY
    };
    floatingButtonDragged = false;
    floatingButton.setPointerCapture(event.pointerId);
    floatingButton.classList.add("qb-floating-dragging");
  }

  function onFloatingPointerMove(event) {
    if (floatingPointerStart?.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = Math.max(0, event.clientX - floatingPointerStart.x);
    const deltaY = event.clientY - floatingPointerStart.y;
    if (deltaX > 4 || Math.abs(deltaY) > 4) {
      floatingButtonDragged = true;
    }

    floatingButton.style.setProperty(
      "--qb-drag-x",
      `${Math.min(deltaX, 52)}px`
    );
    floatingButton.style.setProperty(
      "--qb-drag-y",
      `${Math.max(-80, Math.min(80, deltaY))}px`
    );
  }

  async function onFloatingPointerUp(event) {
    if (floatingPointerStart?.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - floatingPointerStart.x;
    const nearRightEdge = window.innerWidth - event.clientX <= 32;
    const shouldDock = floatingButtonDragged && (deltaX >= 24 || nearRightEdge);
    suppressFloatingClick = floatingButtonDragged;
    resetFloatingPointer(event);

    if (shouldDock) {
      await setFloatingButtonDocked(true);
    }
  }

  function resetFloatingPointer(event) {
    if (
      event?.pointerId !== undefined &&
      floatingButton.hasPointerCapture(event.pointerId)
    ) {
      floatingButton.releasePointerCapture(event.pointerId);
    }
    floatingPointerStart = null;
    floatingButtonDragged = false;
    floatingButton.classList.remove("qb-floating-dragging");
    floatingButton.style.removeProperty("--qb-drag-x");
    floatingButton.style.removeProperty("--qb-drag-y");
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
    cancelScheduledResourceRelease();
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
        ocrText: editedText,
        mode: selectedAnalysisMode,
        subject: selectedSubject,
        userSelectedAnswer: getUserSelectedAnswer()
      });
      handleProcessingResponse(response);
    } catch (error) {
      showError(`Could not analyze edited text: ${error.message}`);
      setStatus("Local AI analysis failed.");
    } finally {
      activeRequestId = null;
      setProcessingState(false);
      scheduleResourceRelease();
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
      renderDeviceDiagnostics(response.diagnostics);
    }
  }

  function renderDeviceDiagnostics(diagnostics) {
    if (!diagnostics) {
      diagnosticsContent.textContent = "Diagnostics are unavailable.";
      return;
    }

    const rows = [
      createDiagnosticRow(
        "WebGPU",
        diagnostics.webgpuAvailable ? "Available" : "Unavailable"
      ),
      createDiagnosticRow("GPU", diagnostics.adapterInfo),
      createDiagnosticRow("Selected model", diagnostics.selectedModel),
      createDiagnosticRow(
        "Estimated memory",
        formatMemory(diagnostics.estimatedVramMB)
      ),
      createDiagnosticRow("Last load", diagnostics.lastModelStatus)
    ];
    if (diagnostics.lastModelError) {
      rows.push(createDiagnosticRow("Last error", diagnostics.lastModelError));
    }
    rows.push(
      createDiagnosticRow("Recommendation", diagnostics.recommendation)
    );
    diagnosticsContent.replaceChildren(...rows);
  }

  function createDiagnosticRow(label, value) {
    const row = createElement("div", "qb-diagnostic-row");
    row.append(
      createElement("span", "qb-diagnostic-label", label),
      createElement("span", "qb-diagnostic-value", value || "Unavailable")
    );
    return row;
  }

  async function generatePracticeQuestion() {
    if (!lastAnalysisContext?.aiResult?.coreKnowledge) {
      showError(
        "A clear core concept is required before generating practice."
      );
      return;
    }

    activeRequestId = crypto.randomUUID();
    cancelScheduledResourceRelease();
    clearError();
    setProcessingState(true);
    setStatus("Generating a similar practice question locally...", true);

    try {
      const response = await chrome.runtime.sendMessage({
        type: "QB_GENERATE_PRACTICE_LOCAL",
        requestId: activeRequestId,
        modelId: selectedModelId,
        subject: selectedSubject,
        mode: selectedAnalysisMode,
        ocrText: lastAnalysisContext.ocrText,
        aiResult: lastAnalysisContext.aiResult
      });
      if (!response?.ok) {
        throw new Error(
          response?.error || "Could not generate a practice question."
        );
      }
      renderPracticeQuestion(response.practiceQuestion);
      setStatus("Practice question ready.");
    } catch (error) {
      showError(`Could not generate practice: ${error.message}`);
      setStatus("Practice generation failed.");
    } finally {
      activeRequestId = null;
      setProcessingState(false);
      scheduleResourceRelease();
    }
  }

  function renderPracticeQuestion(practiceQuestion) {
    let selectedAnswer = "";
    const question = createElement(
      "div",
      "qb-practice-question",
      practiceQuestion.question
    );
    const options = createElement("div", "qb-practice-options");
    practiceQuestion.options.forEach((option) => {
      const button = createElement(
        "button",
        "qb-practice-option",
        `${option.label ? `${option.label}. ` : ""}${option.text}`
      );
      button.type = "button";
      button.addEventListener("click", () => {
        selectedAnswer = option.label || option.text;
        options
          .querySelectorAll(".qb-practice-option")
          .forEach((item) =>
            item.classList.toggle("qb-practice-option-selected", item === button)
          );
      });
      options.append(button);
    });

    const feedback = createElement("div", "qb-practice-feedback qb-hidden");
    const revealButton = createElement(
      "button",
      "qb-practice-reveal",
      "Reveal Answer"
    );
    revealButton.type = "button";
    revealButton.addEventListener("click", () => {
      const evaluation = selectedAnswer
        ? evaluatePracticeAnswer(practiceQuestion, selectedAnswer)
        : null;
      feedback.textContent = `${
        evaluation
          ? evaluation.isCorrect
            ? "Correct. "
            : "Not quite. "
          : ""
      }Answer: ${
        practiceQuestion.answerLabel
          ? `${practiceQuestion.answerLabel}. `
          : ""
      }${practiceQuestion.answerText}\n${practiceQuestion.explanation}`;
      feedback.classList.remove("qb-hidden");
      revealButton.disabled = true;
    });

    practiceCard.replaceChildren(
      question,
      options,
      revealButton,
      feedback
    );
    practiceSection.classList.remove("qb-hidden");
  }

  function renderSessionStudyNotes() {
    if (!sessionStudyNotes.length) {
      notesList.replaceChildren();
      notesSection.classList.add("qb-hidden");
      return;
    }

    notesList.replaceChildren(
      ...sessionStudyNotes.map((note) => {
        const item = createElement("div", "qb-note-item");
        item.append(
          createElement("span", "qb-note-concept", note.concept),
          createElement("span", "qb-note-count", `×${note.count}`)
        );
        return item;
      })
    );
    notesSection.classList.remove("qb-hidden");
  }

  async function openRecropModal() {
    if (!lastScreenshotAvailable || activeRequestId) {
      return;
    }

    clearError();
    setStatus("Loading the last screenshot...", true);
    try {
      const response = await chrome.runtime.sendMessage({
        type: "QB_GET_LAST_SCREENSHOT"
      });
      if (!response?.ok || !response.screenshotDataUrl) {
        lastScreenshotAvailable = false;
        recropButton.disabled = true;
        throw new Error(
          response?.error || "No screenshot is available for re-cropping."
        );
      }
      createRecropModal(response.screenshotDataUrl);
      setStatus("Drag over the screenshot to choose a better crop.");
    } catch (error) {
      showError(error.message);
      setStatus("Re-crop unavailable.");
    }
  }

  function createRecropModal(screenshotDataUrl) {
    const overlay = createElement("div", "qb-recrop-overlay");
    const dialog = createElement("div", "qb-recrop-dialog");
    const header = createElement("div", "qb-recrop-header");
    const title = createElement(
      "div",
      "qb-recrop-title",
      "Re-crop screenshot"
    );
    const close = createElement("button", "qb-recrop-close", "Cancel");
    close.type = "button";
    const frame = createElement("div", "qb-recrop-frame");
    const image = createElement("img", "qb-recrop-image");
    image.alt = "Last captured visible tab";
    image.src = screenshotDataUrl;
    const selection = createElement(
      "div",
      "qb-recrop-selection qb-hidden"
    );
    frame.append(image, selection);
    header.append(title, close);
    dialog.append(header, frame);
    overlay.append(dialog);
    shadowRoot.append(overlay);

    let start = null;
    const closeModal = () => {
      overlay.remove();
      window.removeEventListener("keydown", onKeyDown, true);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        closeModal();
        setStatus("Re-crop cancelled.");
      }
    };
    close.addEventListener("click", closeModal);
    window.addEventListener("keydown", onKeyDown, true);

    frame.addEventListener("mousedown", (event) => {
      if (event.button !== 0 || event.target !== image) {
        return;
      }
      const bounds = image.getBoundingClientRect();
      start = {
        x: clamp(event.clientX - bounds.left, 0, bounds.width),
        y: clamp(event.clientY - bounds.top, 0, bounds.height)
      };
      selection.classList.remove("qb-hidden");
      updateRecropSelection(selection, start.x, start.y, 0, 0);
      event.preventDefault();
    });

    frame.addEventListener("mousemove", (event) => {
      if (!start) {
        return;
      }
      const bounds = image.getBoundingClientRect();
      const rect = normalizeRect(
        start.x,
        start.y,
        clamp(event.clientX - bounds.left, 0, bounds.width),
        clamp(event.clientY - bounds.top, 0, bounds.height)
      );
      updateRecropSelection(
        selection,
        rect.x,
        rect.y,
        rect.width,
        rect.height
      );
    });

    frame.addEventListener("mouseup", async (event) => {
      if (!start) {
        return;
      }
      const bounds = image.getBoundingClientRect();
      const rect = normalizeRect(
        start.x,
        start.y,
        clamp(event.clientX - bounds.left, 0, bounds.width),
        clamp(event.clientY - bounds.top, 0, bounds.height)
      );
      start = null;
      if (rect.width < 30 || rect.height < 30) {
        showError("The re-crop area must be at least 30 × 30 pixels.");
        return;
      }
      closeModal();
      await processRecrop({
        ...rect,
        viewportWidth: bounds.width,
        viewportHeight: bounds.height,
        devicePixelRatio: 1
      });
    });
  }

  async function processRecrop(rect) {
    activeRequestId = crypto.randomUUID();
    cancelScheduledResourceRelease();
    resetOutput();
    setProcessingState(true);
    setStatus("Processing the new crop locally...", true);

    try {
      const response = await chrome.runtime.sendMessage({
        type: "QB_RECROP_LAST_SCREENSHOT",
        requestId: activeRequestId,
        modelId: selectedModelId,
        ocrLanguage: selectedOcrLanguage,
        mode: selectedAnalysisMode,
        subject: selectedSubject,
        userSelectedAnswer: getUserSelectedAnswer(),
        rect
      });
      handleProcessingResponse(response);
    } catch (error) {
      showError(`Could not process the new crop: ${error.message}`);
      setStatus("Re-crop processing failed.");
    } finally {
      activeRequestId = null;
      setProcessingState(false);
      scheduleResourceRelease();
    }
  }

  function updateRecropSelection(selection, x, y, width, height) {
    Object.assign(selection.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${width}px`,
      height: `${height}px`
    });
  }

  function formatMemory(memoryMB) {
    return memoryMB >= 1024
      ? `${(memoryMB / 1024).toFixed(2)} GB`
      : `${Math.round(memoryMB)} MB`;
  }

  function scheduleResourceRelease(delay = 5000) {
    cancelScheduledResourceRelease();
    resourceReleaseTimer = window.setTimeout(() => {
      resourceReleaseTimer = null;
      releaseComputeResources();
    }, delay);
  }

  function cancelScheduledResourceRelease() {
    if (resourceReleaseTimer !== null) {
      window.clearTimeout(resourceReleaseTimer);
      resourceReleaseTimer = null;
    }
  }

  function releaseLocalResources() {
    cancelScheduledResourceRelease();
    lastScreenshotAvailable = false;
    lastAnalysisContext = null;
    sessionStudyNotes = clearSessionStudyNotes();
    renderSessionStudyNotes();
    practiceCard.replaceChildren();
    practiceSection.classList.add("qb-hidden");
    recropButton.disabled = true;
    chrome.runtime
      .sendMessage({ type: "QB_RELEASE_RESOURCES" })
      .catch(() => {});
  }

  function releaseComputeResources() {
    cancelScheduledResourceRelease();
    chrome.runtime
      .sendMessage({ type: "QB_RELEASE_COMPUTE_RESOURCES" })
      .catch(() => {});
  }

  function getUserSelectedAnswer() {
    return checkAnswerCheckbox.checked
      ? userAnswerInput.value.trim()
      : "";
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

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
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
