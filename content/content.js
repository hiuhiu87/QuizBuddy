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
import {
  CUSTOM_INSTRUCTIONS_KEY,
  CUSTOM_INSTRUCTION_TEMPLATES,
  normalizeCustomInstructions,
  resolveCustomInstruction,
  updateCustomInstruction
} from "../lib/custom-instructions.js";
import { numberOcrLines } from "../lib/source-trace.js";

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
  let selectedTheme = "system";
  let sessionStudyNotes = [];
  let lastAnalysisContext = null;
  let lastScreenshotAvailable = false;
  let floatingButtonDocked = false;
  let floatingPointerStart = null;
  let floatingButtonDragged = false;
  let suppressFloatingClick = false;
  let preferencesLoadedPromise = null;
  let resourceReleaseTimer = null;
  let customInstructions = normalizeCustomInstructions(null);
  let pendingQuestionQuality = null;
  let followupStreamingBubble = null;

  const MODEL_SELECTION_KEY = "qbSelectedModelId";
  const OCR_LANGUAGE_KEY = "qbOcrLanguage";
  const FLOATING_BUTTON_DOCKED_KEY = "qbFloatingButtonDocked";
  const ANALYSIS_MODE_KEY = "qbAnalysisMode";
  const SUBJECT_PRESET_KEY = "qbSubjectPreset";
  const THEME_KEY = "qbTheme";
  const systemThemeMedia = window.matchMedia("(prefers-color-scheme: dark)");
  const host = document.createElement("div");
  setProtectedHostStyles(host);
  host.dataset.qbTheme = systemThemeMedia.matches ? "dark" : "light";

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
      <div class="qb-header-actions">
        <button class="qb-theme-button" type="button" aria-label="Switch theme"></button>
        <button class="qb-close-button" type="button" aria-label="Close sidebar">&times;</button>
      </div>
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
        <div class="qb-card-heading">
          <div>
            <div class="qb-card-title">Question setup</div>
            <div class="qb-card-description">Choose how the question is read and explained.</div>
          </div>
        </div>
        <div class="qb-settings-grid">
          <div class="qb-field-group">
            <label class="qb-field-label" for="qb-ocr-language">OCR Language</label>
            <select id="qb-ocr-language" class="qb-select qb-ocr-language">
              ${OCR_LANGUAGE_OPTIONS.map(
                (option) =>
                  `<option value="${option.id}">${option.label}</option>`
              ).join("")}
            </select>
          </div>
          <div class="qb-field-group">
            <label class="qb-field-label" for="qb-subject-preset">Subject</label>
            <select id="qb-subject-preset" class="qb-select qb-subject-preset">
              ${SUBJECT_PRESETS.map(
                (option) =>
                  `<option value="${option.id}">${option.label}</option>`
              ).join("")}
            </select>
          </div>
          <div class="qb-field-group qb-field-group-wide">
            <div class="qb-field-label">Mode</div>
            <div class="qb-mode-selector" role="group" aria-label="Analysis mode">
              ${ANALYSIS_MODES.map(
                (option) =>
                  `<button type="button" class="qb-mode-button" data-mode="${option.id}">${option.label}</button>`
              ).join("")}
            </div>
          </div>
        </div>
        <div class="qb-answer-check">
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
        </div>
        <details class="qb-custom-instructions">
          <summary>
            <span>Custom Instructions</span>
            <span class="qb-details-hint">Optional</span>
          </summary>
          <div class="qb-custom-content">
            <label class="qb-check-answer-toggle">
              <input class="qb-custom-enabled" type="checkbox" />
              <span>Enable custom instruction</span>
            </label>
            <div class="qb-field-group">
              <label class="qb-field-label">Scope</label>
              <select class="qb-select qb-custom-scope" aria-label="Custom instruction scope">
                <option value="global">Global</option>
                <option value="subject">Current subject only</option>
              </select>
            </div>
            <div class="qb-field-group">
              <label class="qb-field-label">Template</label>
              <select class="qb-select qb-custom-template" aria-label="Custom instruction template">
                <option value="">Choose a template...</option>
                ${CUSTOM_INSTRUCTION_TEMPLATES.map(
                  (template) =>
                    `<option value="${template.id}">${template.label}</option>`
                ).join("")}
              </select>
            </div>
            <textarea class="qb-custom-text" rows="4" maxlength="2000" placeholder="Add local instructions for the selected scope"></textarea>
            <div class="qb-custom-actions">
              <button class="qb-custom-save" type="button">Save</button>
              <button class="qb-custom-reset" type="button">Reset</button>
              <button class="qb-custom-default" type="button">Restore default</button>
            </div>
            <div class="qb-local-note">Stored only in this browser.</div>
          </div>
        </details>
      </section>
      <section class="qb-primary-actions">
        <button class="qb-crop-button" type="button">Crop Question</button>
        <div class="qb-status" role="status" aria-live="polite">Ready to crop a question.</div>
        <button class="qb-cancel-button qb-hidden" type="button">Cancel current task</button>
      </section>
      <section class="qb-quality-card qb-hidden" role="alert">
        <div class="qb-quality-title">This question may be incomplete.</div>
        <div class="qb-quality-reasons"></div>
        <div class="qb-quality-actions">
          <button class="qb-quality-analyze" type="button">Analyze anyway</button>
          <button class="qb-quality-edit" type="button">Edit OCR</button>
          <button class="qb-quality-recrop" type="button">Crop again</button>
        </div>
      </section>
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
      <section class="qb-section qb-followup-section qb-hidden">
        <h2 class="qb-section-title">Ask Follow-up</h2>
        <div class="qb-followup-chips">
          ${[
            "Explain simpler",
            "Why not other choices?",
            "Give similar example",
            "Explain in Vietnamese",
            "Make a mnemonic"
          ].map((label) => `<button type="button" class="qb-followup-chip">${label}</button>`).join("")}
        </div>
        <div class="qb-followup-messages"></div>
        <div class="qb-followup-compose">
          <input class="qb-followup-input" type="text" placeholder="Ask a follow-up..." aria-label="Ask a follow-up" />
          <button class="qb-followup-send" type="button">Send</button>
        </div>
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
  const themeButton = sidebar.querySelector(".qb-theme-button");
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
  const cancelButton = sidebar.querySelector(".qb-cancel-button");
  const qualityCard = sidebar.querySelector(".qb-quality-card");
  const qualityReasons = sidebar.querySelector(".qb-quality-reasons");
  const qualityAnalyzeButton = sidebar.querySelector(".qb-quality-analyze");
  const qualityEditButton = sidebar.querySelector(".qb-quality-edit");
  const qualityRecropButton = sidebar.querySelector(".qb-quality-recrop");
  const customEnabled = sidebar.querySelector(".qb-custom-enabled");
  const customScope = sidebar.querySelector(".qb-custom-scope");
  const customTemplate = sidebar.querySelector(".qb-custom-template");
  const customText = sidebar.querySelector(".qb-custom-text");
  const customSave = sidebar.querySelector(".qb-custom-save");
  const customReset = sidebar.querySelector(".qb-custom-reset");
  const customDefault = sidebar.querySelector(".qb-custom-default");
  const followupSection = sidebar.querySelector(".qb-followup-section");
  const followupMessages = sidebar.querySelector(".qb-followup-messages");
  const followupInput = sidebar.querySelector(".qb-followup-input");
  const followupSend = sidebar.querySelector(".qb-followup-send");
  const followupChips = [...sidebar.querySelectorAll(".qb-followup-chip")];

  applyTheme();
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
  themeButton.addEventListener("click", toggleTheme);

  cropButton.addEventListener("click", startCropMode);
  analyzeButton.addEventListener("click", () => analyzeEditedOCRText(false));
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
  cancelButton.addEventListener("click", cancelActiveTask);
  qualityAnalyzeButton.addEventListener("click", () => analyzeEditedOCRText(true));
  qualityEditButton.addEventListener("click", () => {
    ocrTextarea.focus();
    qualityCard.classList.add("qb-hidden");
  });
  qualityRecropButton.addEventListener("click", () => {
    qualityCard.classList.add("qb-hidden");
    openRecropModal();
  });
  customSave.addEventListener("click", saveCustomInstruction);
  customReset.addEventListener("click", loadCustomInstructionEditor);
  customDefault.addEventListener("click", restoreDefaultCustomInstruction);
  customScope.addEventListener("change", loadCustomInstructionEditor);
  customTemplate.addEventListener("change", () => {
    const template = CUSTOM_INSTRUCTION_TEMPLATES.find(
      (item) => item.id === customTemplate.value
    );
    if (template) customText.value = template.text;
  });
  followupSend.addEventListener("click", () => sendFollowUp());
  followupInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") sendFollowUp();
  });
  followupChips.forEach((chip) =>
    chip.addEventListener("click", () => sendFollowUp(chip.textContent))
  );
  floatingButton.addEventListener("pointerdown", onFloatingPointerDown);
  floatingButton.addEventListener("pointermove", onFloatingPointerMove);
  floatingButton.addEventListener("pointerup", onFloatingPointerUp);
  floatingButton.addEventListener("pointercancel", resetFloatingPointer);
  window.addEventListener("pagehide", releaseLocalResources);
  systemThemeMedia.addEventListener("change", () => {
    if (selectedTheme === "system") {
      applyTheme();
    }
  });
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
      ((message.taskId || message.requestId) === activeRequestId ||
        (message.taskId || message.requestId) === modelRequestId)
    ) {
      if ((message.taskId || message.requestId) === modelRequestId) {
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
      (message.taskId || message.requestId) === activeRequestId
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

  async function startCropMode() {
    if (!modelReady) {
      showError(
        "Download and prepare the local AI model before cropping a question."
      );
      setStatus("Local AI model is not ready.");
      return;
    }

    if (activeRequestId) {
      const replaceTask = window.confirm(
        "A local task is still running. Cancel it and start a new crop?"
      );
      if (!replaceTask) {
        return;
      }
      await cancelActiveTask();
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
    const taskId = activeRequestId;

    try {
      const response = await chrome.runtime.sendMessage({
        type: "QB_CAPTURE_PROCESS_LOCAL",
        requestId: taskId,
        taskId,
        modelId: selectedModelId,
        ocrLanguage: selectedOcrLanguage,
        mode: selectedAnalysisMode,
        subject: selectedSubject,
        userSelectedAnswer: getUserSelectedAnswer(),
        customInstruction: getActiveCustomInstruction(),
        rect: {
          ...rect,
          devicePixelRatio: window.devicePixelRatio || 1,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        },
      });

      if (activeRequestId !== taskId) return;
      setCaptureVisibility(false);
      handleProcessingResponse(response);
    } catch (error) {
      setCaptureVisibility(false);
      showError(
        `Could not process the question: ${error.message || "Unknown extension error."}`
      );
      setStatus("Processing failed.");
    } finally {
      if (activeRequestId === taskId) {
        activeRequestId = null;
        setProcessingState(false);
        scheduleResourceRelease();
      }
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
      if (response.cancelled) {
        setStatus("Task cancelled.");
        return;
      }
      if (response.requiresQualityDecision) {
        pendingQuestionQuality = response.questionQuality;
        renderQuestionQuality(response.questionQuality, true);
        setStatus("Review the question quality before continuing.");
        return;
      }
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
      analysisResult: response.aiResult,
      aiResult: response.aiResult,
      numberedLines: numberOcrLines(response.ocrText || ocrTextarea.value),
      questionQuality: response.questionQuality,
      subject: selectedSubject,
      mode: selectedAnalysisMode
    };
    renderQuestionQuality(response.questionQuality, false);
    followupSection.classList.remove("qb-hidden");
    const analyzedQuestions =
      response.aiResult.questions?.length
        ? response.aiResult.questions
        : [response.aiResult];
    analyzedQuestions.forEach((question) => {
      sessionStudyNotes = addSessionStudyNote(
        sessionStudyNotes,
        question.coreKnowledge
      );
    });
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

    if (result.questionQuality) {
      renderQuestionQuality(result.questionQuality, false);
    }

    if (result.partialAIResult) {
      renderAIResult(result.partialAIResult);
    }

    if (result.followupText && followupStreamingBubble) {
      followupStreamingBubble.textContent = result.followupText;
      followupStreamingBubble.classList.remove("qb-followup-pending");
    }
  }

  function renderAIResult(result) {
    const questions =
      Array.isArray(result.questions) && result.questions.length
        ? result.questions
        : [result];
    const children = [];
    if (questions.length > 1 || result.batchIncomplete) {
      const summary = createElement("div", "qb-batch-summary");
      const expectedCount = Math.max(
        questions.length,
        Number(result.estimatedQuestionCount) || questions.length
      );
      summary.append(
        createElement(
          "div",
          "qb-batch-summary-title",
          result.batchIncomplete
            ? `${questions.length} of approximately ${expectedCount} questions analyzed`
            : `${questions.length} questions detected`
        ),
        createElement(
          "div",
          "qb-batch-summary-meta",
          result.batchIncomplete
            ? "Review the OCR split or analyze again."
            : `${getModelProfile(selectedModelId).label} · ${getSubjectPreset(selectedSubject).label}`
        )
      );
      summary.classList.toggle(
        "qb-batch-summary-warning",
        result.batchIncomplete === true
      );
      children.push(summary);
    }
    questions.forEach((question, index) => {
      children.push(
        createQuestionResult(question, index, questions.length)
      );
    });

    resultCard.classList.toggle("qb-result-card-batch", questions.length > 1);
    resultCard.replaceChildren(...children);
    resultSection.classList.remove("qb-hidden");
  }

  function createQuestionResult(result, index, totalQuestions) {
    const container = createElement("article", "qb-question-result");
    if (totalQuestions > 1) {
      const heading = createElement("div", "qb-question-result-heading");
      heading.append(
        createElement(
          "span",
          "qb-question-number",
          `Question ${result.questionNumber || index + 1}`
        ),
        createElement(
          "span",
          `qb-confidence-badge qb-confidence-${result.confidence}`,
          result.confidence || "low"
        )
      );
      container.append(heading);
      if (result.questionText) {
        container.append(
          createElement(
            "div",
            "qb-question-text",
            result.questionText
          )
        );
      }
    }

    const answerSelections = Array.isArray(result.answerSelections)
      ? result.answerSelections
      : [];
    const suggestedAnswer = answerSelections.length
      ? answerSelections
          .map((selection) =>
            selection.label
              ? `${selection.label}. ${selection.text}`
              : selection.text
          )
          .join("\n")
      : result.answerLabel
        ? `${result.answerLabel}. ${result.answerText}`
        : result.answerText;
    const reliability = result.overallReliability || {
      level: "low",
      reasons: ["Reliability details are unavailable."]
    };
    const items = [
      createResultItem(
        answerSelections.length > 1
          ? `Answers (${answerSelections.length})`
          : "Answer",
        suggestedAnswer,
        "qb-answer"
      ),
      ...(totalQuestions === 1
        ? [
            createResultItem("AI Confidence", result.confidence),
            createResultItem(
              "Local Model",
              getModelProfile(selectedModelId).label
            ),
            createResultItem(
              "Subject",
              getSubjectPreset(selectedSubject).label
            )
          ]
        : []),
      createResultItem("Overall Reliability", reliability.level),
      createResultItem(
        "Reliability Reasons",
        reliability.reasons.join("\n")
      ),
      createResultItem("Why this answer?", result.shortExplanation)
    ];

    if (result.userAnswerEvaluation) {
      items.push(createUserAnswerEvaluation(result.userAnswerEvaluation));
    }
    if (result.sourceTrace?.length) {
      items.push(createSourceTrace(result.sourceTrace));
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
          "Practice This Concept"
        );
        practiceButton.type = "button";
        practiceButton.addEventListener("click", () =>
          generatePracticeQuestion(result)
        );
        items.push(practiceButton);
      }
    }
    container.append(...items);
    return container;
  }

  function createSourceTrace(sourceTrace) {
    const details = createElement("details", "qb-result-details");
    const summary = createElement(
      "summary",
      "qb-result-details-summary",
      "Source Trace"
    );
    const list = createElement("div", "qb-source-trace-list");
    sourceTrace.forEach((trace) => {
      const item = createElement("div", "qb-source-trace-item");
      item.append(createElement("div", "qb-option-title", trace.claim));
      const refs = createElement("div", "qb-source-trace-refs");
      trace.lineRefs.forEach((lineNumber) => {
        const button = createElement(
          "button",
          "qb-source-line-button",
          `Line ${lineNumber}`
        );
        button.type = "button";
        button.addEventListener("click", () => focusOcrLine(lineNumber));
        refs.append(button);
      });
      if (refs.childElementCount) item.append(refs);
      if (trace.reason) {
        item.append(createElement("div", "qb-option-reason", trace.reason));
      }
      list.append(item);
    });
    details.append(summary, list);
    return details;
  }

  function focusOcrLine(lineNumber) {
    const nonEmptyLines = [];
    const source = ocrTextarea.value;
    let offset = 0;
    source.split("\n").forEach((line) => {
      const start = offset;
      const end = offset + line.length;
      if (line.trim()) nonEmptyLines.push({ start, end });
      offset = end + 1;
    });
    const target = nonEmptyLines[lineNumber - 1];
    if (!target) return;
    ocrTextarea.focus();
    ocrTextarea.setSelectionRange(target.start, target.end);
  }

  function renderQuestionQuality(questionQuality, requiresDecision) {
    pendingQuestionQuality = questionQuality || null;
    if (!questionQuality || questionQuality.status === "good") {
      qualityCard.classList.add("qb-hidden");
      return;
    }
    qualityReasons.textContent = [
      ...(questionQuality.reasons || []).map((reason) => `• ${reason.message}`),
      ...(questionQuality.suggestions || []).map((suggestion) => `• ${suggestion}`)
    ].join("\n");
    qualityAnalyzeButton.classList.toggle("qb-hidden", !requiresDecision);
    qualityCard.classList.remove("qb-hidden");
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
    followupMessages.replaceChildren();
    followupStreamingBubble = null;
    followupSection.classList.add("qb-hidden");
    qualityCard.classList.add("qb-hidden");
    pendingQuestionQuality = null;
    lastAnalysisContext = null;
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
    cancelButton.classList.toggle("qb-hidden", !processing);
    cancelButton.disabled = !processing;
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
          SUBJECT_PRESET_KEY,
          THEME_KEY,
          CUSTOM_INSTRUCTIONS_KEY
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
          selectedTheme = normalizeTheme(storage[THEME_KEY]);
          floatingButtonDocked =
            storage[FLOATING_BUTTON_DOCKED_KEY] === true;
          customInstructions = normalizeCustomInstructions(
            storage[CUSTOM_INSTRUCTIONS_KEY]
          );
          modelSelect.value = selectedModelId;
          ocrLanguageSelect.value = selectedOcrLanguage;
          subjectSelect.value = selectedSubject;
          applyAnalysisMode();
          applyTheme();
          applyFloatingButtonDockState();
          customEnabled.checked = customInstructions.enabled;
          loadCustomInstructionEditor();
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
    loadCustomInstructionEditor();
  }

  function loadCustomInstructionEditor() {
    const normalized = normalizeCustomInstructions(customInstructions);
    customEnabled.checked = normalized.enabled;
    customText.value =
      customScope.value === "subject"
        ? normalized.bySubject[selectedSubject] || ""
        : normalized.global;
    customTemplate.value = "";
  }

  async function saveCustomInstruction() {
    customInstructions = updateCustomInstruction(customInstructions, {
      instruction: customText.value,
      scope: customScope.value,
      subject: selectedSubject,
      enabled: customEnabled.checked
    });
    await chrome.storage.local.set({
      [CUSTOM_INSTRUCTIONS_KEY]: customInstructions
    });
    setStatus("Custom instruction saved locally.");
  }

  async function restoreDefaultCustomInstruction() {
    customInstructions = normalizeCustomInstructions(null);
    await chrome.storage.local.set({
      [CUSTOM_INSTRUCTIONS_KEY]: customInstructions
    });
    loadCustomInstructionEditor();
    setStatus("Custom instructions restored to default.");
  }

  function getActiveCustomInstruction() {
    return resolveCustomInstruction(customInstructions, selectedSubject);
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

  async function toggleTheme() {
    selectedTheme = getEffectiveTheme() === "dark" ? "light" : "dark";
    applyTheme();
    await chrome.storage.local.set({
      [THEME_KEY]: selectedTheme
    });
  }

  function applyTheme() {
    const theme = getEffectiveTheme();
    host.dataset.qbTheme = theme;
    if (!themeButton) {
      return;
    }
    const nextTheme = theme === "dark" ? "light" : "dark";
    themeButton.textContent = nextTheme === "dark" ? "Dark" : "Light";
    themeButton.title = `Switch to ${nextTheme} mode`;
    themeButton.setAttribute(
      "aria-label",
      `Switch to ${nextTheme} mode`
    );
    themeButton.setAttribute("aria-pressed", String(theme === "dark"));
  }

  function getEffectiveTheme() {
    if (selectedTheme === "dark" || selectedTheme === "light") {
      return selectedTheme;
    }
    return systemThemeMedia.matches ? "dark" : "light";
  }

  function normalizeTheme(value) {
    return value === "dark" || value === "light" ? value : "system";
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

  async function analyzeEditedOCRText(analyzeAnyway = false) {
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
    const taskId = activeRequestId;
    cancelScheduledResourceRelease();
    clearError();
    resultSection.classList.add("qb-hidden");
    resultCard.replaceChildren();
    setProcessingState(true);
    setStatus("Analyzing edited text locally...", true);

    try {
      const response = await chrome.runtime.sendMessage({
        type: "QB_ANALYZE_TEXT_LOCAL",
        requestId: taskId,
        taskId,
        modelId: selectedModelId,
        ocrText: editedText,
        mode: selectedAnalysisMode,
        subject: selectedSubject,
        userSelectedAnswer: getUserSelectedAnswer(),
        questionQuality: pendingQuestionQuality,
        analyzeAnyway,
        customInstruction: getActiveCustomInstruction()
      });
      if (activeRequestId !== taskId) return;
      handleProcessingResponse(response);
    } catch (error) {
      showError(`Could not analyze edited text: ${error.message}`);
      setStatus("Local AI analysis failed.");
    } finally {
      if (activeRequestId === taskId) {
        activeRequestId = null;
        setProcessingState(false);
        scheduleResourceRelease();
      }
    }
  }

  async function cancelActiveTask() {
    const taskId = activeRequestId || modelRequestId;
    if (!taskId) return;
    activeRequestId = null;
    modelRequestId = null;
    cancelButton.disabled = true;
    setStatus("Cancelling local task...", true);
    try {
      await chrome.runtime.sendMessage({
        type: "QB_CANCEL_TASK",
        taskId
      });
    } catch {
      // The task may have completed while cancellation was requested.
    }
    setProcessingState(false);
    setStatus("Task cancelled.");
  }

  async function sendFollowUp(quickMessage = "") {
    const userMessage = String(quickMessage || followupInput.value).trim();
    if (!lastAnalysisContext?.analysisResult) {
      showError("Analyze a question first to ask follow-up.");
      return;
    }
    if (!userMessage || activeRequestId) return;

    const userBubble = createElement(
      "div",
      "qb-followup-message qb-followup-user",
      userMessage
    );
    followupMessages.append(userBubble);
    followupStreamingBubble = createElement(
      "div",
      "qb-followup-message qb-followup-ai qb-followup-pending",
      "Thinking"
    );
    followupMessages.append(followupStreamingBubble);
    followupStreamingBubble.scrollIntoView({
      block: "nearest",
      behavior: "smooth"
    });
    followupInput.value = "";
    activeRequestId = crypto.randomUUID();
    const taskId = activeRequestId;
    setProcessingState(true);
    setStatus("Answering follow-up locally...", true);

    try {
      const response = await chrome.runtime.sendMessage({
        type: "QB_FOLLOW_UP_LOCAL",
        requestId: taskId,
        taskId,
        modelId: selectedModelId,
        userMessage,
        questionContext: {
          ocrText: lastAnalysisContext.ocrText,
          analysisResult: lastAnalysisContext.analysisResult,
          subject: lastAnalysisContext.subject,
          mode: lastAnalysisContext.mode,
          questionQuality: lastAnalysisContext.questionQuality
        },
        customInstruction: getActiveCustomInstruction()
      });
      if (activeRequestId !== taskId) return;
      if (!response?.ok) {
        if (response?.cancelled) {
          setStatus("Task cancelled.");
          return;
        }
        throw new Error(response?.error || "Could not answer the follow-up.");
      }
      const reply =
        followupStreamingBubble ||
        createElement("div", "qb-followup-message qb-followup-ai");
      reply.classList.remove("qb-followup-pending");
      reply.replaceChildren(document.createTextNode(response.reply));
      if (response.sourceTrace?.length) {
        reply.append(createSourceTrace(response.sourceTrace));
      }
      if (!reply.isConnected) followupMessages.append(reply);
      setStatus("Follow-up ready.");
    } catch (error) {
      if (followupStreamingBubble) {
        followupStreamingBubble.classList.remove("qb-followup-pending");
        followupStreamingBubble.textContent =
          "Could not complete this follow-up.";
      }
      showError(`Could not answer follow-up: ${error.message}`);
      setStatus("Follow-up failed.");
    } finally {
      followupStreamingBubble = null;
      if (activeRequestId === taskId) {
        activeRequestId = null;
        setProcessingState(false);
        scheduleResourceRelease();
      }
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

  async function generatePracticeQuestion(questionResult = null) {
    const selectedQuestion =
      questionResult ||
      lastAnalysisContext?.analysisResult?.questions?.[0] ||
      lastAnalysisContext?.aiResult;
    if (!selectedQuestion?.coreKnowledge) {
      showError(
        "A clear core concept is required before generating practice."
      );
      return;
    }

    activeRequestId = crypto.randomUUID();
    const taskId = activeRequestId;
    cancelScheduledResourceRelease();
    clearError();
    setProcessingState(true);
    setStatus("Generating a similar practice question locally...", true);

    try {
      const response = await chrome.runtime.sendMessage({
        type: "QB_GENERATE_PRACTICE_LOCAL",
        requestId: taskId,
        taskId,
        modelId: selectedModelId,
        subject: selectedSubject,
        mode: selectedAnalysisMode,
        ocrText: getScopedQuestionText(selectedQuestion),
        aiResult: selectedQuestion
      });
      if (activeRequestId !== taskId) return;
      if (!response?.ok) {
        if (response?.cancelled) {
          setStatus("Task cancelled.");
          return;
        }
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
      if (activeRequestId === taskId) {
        activeRequestId = null;
        setProcessingState(false);
        scheduleResourceRelease();
      }
    }
  }

  function getScopedQuestionText(question) {
    if (!question?.questionLineRefs?.length) {
      return question?.questionText || lastAnalysisContext?.ocrText || "";
    }
    const lineByNumber = new Map(
      lastAnalysisContext.numberedLines.lines.map((line) => [
        line.lineNumber,
        line.text
      ])
    );
    return question.questionLineRefs
      .map((lineNumber) => lineByNumber.get(lineNumber))
      .filter(Boolean)
      .join("\n");
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
    const taskId = activeRequestId;
    cancelScheduledResourceRelease();
    resetOutput();
    setProcessingState(true);
    setStatus("Processing the new crop locally...", true);

    try {
      const response = await chrome.runtime.sendMessage({
        type: "QB_RECROP_LAST_SCREENSHOT",
        requestId: taskId,
        taskId,
        modelId: selectedModelId,
        ocrLanguage: selectedOcrLanguage,
        mode: selectedAnalysisMode,
        subject: selectedSubject,
        userSelectedAnswer: getUserSelectedAnswer(),
        customInstruction: getActiveCustomInstruction(),
        rect
      });
      if (activeRequestId !== taskId) return;
      handleProcessingResponse(response);
    } catch (error) {
      showError(`Could not process the new crop: ${error.message}`);
      setStatus("Re-crop processing failed.");
    } finally {
      if (activeRequestId === taskId) {
        activeRequestId = null;
        setProcessingState(false);
        scheduleResourceRelease();
      }
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
    followupMessages.replaceChildren();
    followupStreamingBubble = null;
    followupSection.classList.add("qb-hidden");
    qualityCard.classList.add("qb-hidden");
    pendingQuestionQuality = null;
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
