import extensionStyles from "./content.css";
import designTokenStyles from "./styles/tokens.css";
import primitiveStyles from "./styles/primitives.css";
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
import katexFontsCSS from "./katex-fonts-base64.css";
import katexStyles from "katex/dist/katex.min.css";
import { containsLatexMarkers, renderTextWithFormulas } from "../lib/formula-render.js";
import { expandFormulasForPrompt } from "../lib/formula-detection.js";
import {
  createArtifact,
  createContextItem,
  createWorkspace,
  stripTransientContext
} from "../lib/knowledge-contracts.js";
import {
  createSkillRegistry,
  normalizeCustomSkill
} from "../lib/skill-registry.js";
import { WorkspaceStore } from "../lib/workspace-store.js";
import {
  exportWorkspaceBundle,
  importWorkspaceBundle,
  searchWorkspaceRecords,
  toMarkdownExport
} from "../lib/workspace-utils.js";
import { createMetricEvent } from "../lib/product-metrics.js";
import {
  parseMarkdownBlocks,
  parseMarkdownInline
} from "../lib/markdown-utils.js";

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
  let selectedAnalysisInputMode = "ocr";
  let selectedTheme = "system";
  let selectedProvider = "local";
  let selectedOpenaiBaseUrl = "https://api.openai.com/v1";
  let selectedOpenaiApiKey = "";
  let selectedOpenaiModel = "gpt-4o-mini";
  let sessionStudyNotes = [];
  let currentFormulas = [];
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
  let selectedWorkspaceTab = "chat";
  let chatHistory = [];
  let pendingChatImage = null;
  let chatStreamingBubble = null;
  let currentKnowledgeContext = null;
  let knowledgeContexts = [];
  let currentSkillResult = null;
  let currentWorkspace = null;
  let retentionPolicy = "30-days";
  let workspaceStore = createPersistentWorkspaceClient();
  let userProfile = {};
  let customSkills = [];
  let skillRegistry = createSkillRegistry();
  let activeKnowledgeSkillId = "";
  let lastKnowledgeRunSignature = "";
  let sidebarWidth = 390;
  let sidebarResizeState = null;

  const MODEL_SELECTION_KEY = "qbSelectedModelId";
  const OCR_LANGUAGE_KEY = "qbOcrLanguage";
  const FLOATING_BUTTON_DOCKED_KEY = "qbFloatingButtonDocked";
  const ANALYSIS_MODE_KEY = "qbAnalysisMode";
  const SUBJECT_PRESET_KEY = "qbSubjectPreset";
  const ANALYSIS_INPUT_MODE_KEY = "qbAnalysisInputMode";
  const THEME_KEY = "qbTheme";
  const PROVIDER_KEY = "qbProvider";
  const OPENAI_BASE_URL_KEY = "qbOpenAiBaseUrl";
  const OPENAI_API_KEY_KEY = "qbOpenAiApiKey";
  const OPENAI_MODEL_KEY = "qbOpenAiModel";
  const RETENTION_POLICY_KEY = "qbRetentionPolicy";
  const ACTIVE_WORKSPACE_KEY = "qbActiveWorkspaceId";
  const PROFILE_KEY = "qbKnowledgeProfile";
  const SIDEBAR_WIDTH_KEY = "qbSidebarWidth";
  const systemThemeMedia = window.matchMedia("(prefers-color-scheme: dark)");
  const host = document.createElement("div");
  setProtectedHostStyles(host);
  host.dataset.qbTheme = systemThemeMedia.matches ? "dark" : "light";

  const shadowRoot = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = [
    designTokenStyles,
    primitiveStyles,
    extensionStyles,
    katexStyles
  ].join("\n");
  shadowRoot.append(style);

  // Inject KaTeX base64 fonts into document head so it is visible to shadow DOM
  if (!document.getElementById("qb-katex-fonts")) {
    const fontStyle = document.createElement("style");
    fontStyle.id = "qb-katex-fonts";
    fontStyle.textContent = katexFontsCSS;
    document.head.appendChild(fontStyle);
  }

  const floatingButton = createElement("button", "qb-floating-button");
  floatingButton.type = "button";
  floatingButton.title = "Open QuizBuddy Labs";
  floatingButton.setAttribute("aria-label", "Open QuizBuddy Labs");
  const icon = document.createElement("img");
  icon.src = floatingIconUrl;
  icon.alt = "";
  icon.className = "qb-floating-icon";
  icon.setAttribute("aria-hidden", "true");
  const dockHandle = createElement("span", "qb-floating-dock-handle", "‹");
  dockHandle.setAttribute("aria-hidden", "true");
  floatingButton.append(icon, dockHandle);

  const sidebar = createElement("aside", "qb-sidebar");
  sidebar.setAttribute("aria-label", "QuizBuddy Labs");
  sidebar.innerHTML = `
    <div class="qb-sidebar-resize-handle" role="separator" tabindex="0" aria-label="Resize sidebar" aria-orientation="vertical" title="Drag to resize. Double-click to reset."></div>
    <div class="qb-sidebar-header">
      <div>
        <div class="qb-title">QuizBuddy Labs</div>
        <div class="qb-subtitle">Local-first Knowledge Copilot</div>
      </div>
      <div class="qb-header-actions">
        <button class="qb-settings-button" type="button" aria-label="Open settings" title="Settings">Settings</button>
        <button class="qb-close-button" type="button" aria-label="Close sidebar">&times;</button>
      </div>
    </div>
    <div class="qb-workspace-tabs" role="tablist" aria-label="QuizBuddy workspace">
      <button class="qb-workspace-tab qb-workspace-tab-active" type="button" role="tab" aria-selected="true" data-workspace-tab="chat">
        <span class="qb-tab-label">Ask</span>
        <span class="qb-tab-hint">Anything</span>
      </button>
      <button class="qb-workspace-tab" type="button" role="tab" aria-selected="false" data-workspace-tab="quick">
        <span class="qb-tab-label">Solve</span>
        <span class="qb-tab-hint">A question</span>
      </button>
      <button class="qb-workspace-tab" type="button" role="tab" aria-selected="false" data-workspace-tab="capture">
        <span class="qb-tab-label">Capture</span>
        <span class="qb-tab-hint">Page content</span>
      </button>
      <button class="qb-workspace-tab" type="button" role="tab" aria-selected="false" data-workspace-tab="library">
        <span class="qb-tab-label">Library</span>
        <span class="qb-tab-hint">Saved work</span>
      </button>
    </div>
    <div class="qb-knowledge-panel qb-workspace-panel qb-hidden" role="tabpanel" data-workspace-panel="capture">
      <div class="qb-knowledge-hero">
        <div class="qb-eyebrow">Structured workflow</div>
        <div class="qb-knowledge-title">Capture and transform</div>
        <div class="qb-knowledge-description">Choose a source first, then apply one focused skill to it.</div>
      </div>
      <div class="qb-step-label"><span>1</span> Choose a source</div>
      <div class="qb-capture-actions">
        <button class="qb-capture-selection" type="button"><strong>Selection</strong><span>Highlighted text</span></button>
        <button class="qb-capture-page" type="button"><strong>Current page</strong><span>Readable content</span></button>
        <button class="qb-capture-last-crop" type="button"><strong>Last crop</strong><span>Recent image text</span></button>
        <button class="qb-capture-quiz" type="button"><strong>New crop</strong><span>Select on screen</span></button>
      </div>
      <div class="qb-knowledge-status" role="status">Select text on the page or capture the readable page content.</div>
      <section class="qb-knowledge-card qb-context-editor qb-hidden">
        <label class="qb-field-label" for="qb-context-title">Context title</label>
        <input id="qb-context-title" class="qb-input qb-context-title" maxlength="160" />
        <label class="qb-field-label" for="qb-context-text">Editable context preview</label>
        <textarea id="qb-context-text" class="qb-knowledge-textarea qb-context-text" rows="10" maxlength="120000"></textarea>
        <div class="qb-context-source"></div>
        <button class="qb-add-source" type="button">Add Source to Workspace</button>
      </section>
      <section class="qb-knowledge-card qb-skill-controls">
        <div class="qb-step-label"><span>2</span> Choose a skill</div>
        <label class="qb-field-label" for="qb-skill-select">Skill</label>
        <select id="qb-skill-select" class="qb-select qb-skill-select">
          ${skillRegistry
            .list()
            .filter((skill) => !skill.custom)
            .map((skill) => `<option value="${skill.id}">${skill.name}</option>`)
            .join("")}
        </select>
        <label class="qb-field-label" for="qb-skill-setting">Skill option or question</label>
        <input id="qb-skill-setting" class="qb-input qb-skill-setting" placeholder="Beginner, brief, facts, professional, Vietnamese, or a question" />
        <button class="qb-run-skill" type="button" disabled>Run Skill</button>
      </section>
      <section class="qb-knowledge-card qb-skill-result qb-hidden">
        <div class="qb-section-heading-row">
          <div class="qb-card-title qb-skill-result-title">Result</div>
          <button class="qb-save-artifact" type="button">Save</button>
        </div>
        <div class="qb-skill-result-content"></div>
        <div class="qb-skill-result-meta"></div>
      </section>
      <details class="qb-knowledge-card qb-personalization">
        <summary>Advanced personalization</summary>
        <div class="qb-personalization-grid">
          <input class="qb-input qb-profile-language" placeholder="Preferred language" />
          <input class="qb-input qb-profile-occupation" placeholder="Occupation" />
          <input class="qb-input qb-profile-expertise" placeholder="Expertise level" />
          <input class="qb-input qb-profile-tone" placeholder="Preferred tone" />
          <input class="qb-input qb-profile-format" placeholder="Preferred output format" />
          <button class="qb-profile-save" type="button">Save Profile</button>
        </div>
        <div class="qb-memory-editor">
          <input class="qb-input qb-memory-label" placeholder="Memory label" />
          <input class="qb-input qb-memory-value" placeholder="What should QuizBuddy remember?" />
          <button class="qb-memory-save" type="button">Remember</button>
          <div class="qb-memory-list"></div>
        </div>
        <div class="qb-custom-skill-editor">
          <input class="qb-input qb-custom-skill-name" placeholder="Custom skill name" />
          <input class="qb-input qb-custom-skill-description" placeholder="Short description" />
          <textarea class="qb-knowledge-textarea qb-custom-skill-instruction" rows="3" maxlength="8000" placeholder="Declarative instruction"></textarea>
          <select class="qb-select qb-custom-skill-input">
            <option value="selection,crop,page,artifact">Text, crop, page, or artifact</option>
            <option value="selection">Selected text only</option>
            <option value="page">Page only</option>
            <option value="artifact">Artifact only</option>
          </select>
          <select class="qb-select qb-custom-skill-output">
            <option value="markdown">Markdown output</option>
            <option value="json">JSON output</option>
            <option value="table">Table output</option>
          </select>
          <button class="qb-custom-skill-save" type="button">Add Custom Skill</button>
        </div>
      </details>
      <div class="qb-knowledge-error qb-hidden" role="alert"></div>
    </div>
    <div class="qb-settings-panel qb-workspace-panel qb-hidden" role="tabpanel" data-workspace-panel="settings">
      <div class="qb-panel-heading">
        <button class="qb-settings-back" type="button" aria-label="Back to Ask">Back</button>
        <div>
          <div class="qb-eyebrow">Preferences</div>
          <div class="qb-panel-title">Settings</div>
          <div class="qb-panel-description">AI provider, model, OCR and answer behavior.</div>
        </div>
      </div>
      <section class="qb-model-card">
        <div class="qb-model-card-title">AI Provider & Model</div>
        
        <div class="qb-field-group">
          <label class="qb-field-label" for="qb-provider-select">Provider</label>
          <select id="qb-provider-select" class="qb-select qb-provider-select">
            <option value="local">Local WebGPU (No Internet)</option>
            <option value="openai">OpenAI Compatible API</option>
          </select>
        </div>

        <div class="qb-local-settings-group">
          <label class="qb-field-label" for="qb-model-select" style="margin-top: 10px;">Model</label>
          <select id="qb-model-select" class="qb-select qb-model-select">
            ${MODEL_PROFILES.map(
              (profile) =>
                `<option value="${profile.id}">${profile.label} - ${profile.familyLabel || "Qwen2.5"} ${profile.parameterLabel}</option>`
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
        </div>

        <div class="qb-openai-settings-group qb-hidden">
          <div class="qb-field-group" style="margin-top: 10px;">
            <label class="qb-field-label" for="qb-openai-url">API Base URL</label>
            <input id="qb-openai-url" class="qb-input qb-openai-url" type="text" placeholder="https://api.openai.com/v1" />
          </div>
          <div class="qb-field-group" style="margin-top: 10px;">
            <label class="qb-field-label" for="qb-openai-key">API Key</label>
            <input id="qb-openai-key" class="qb-input qb-openai-key" type="password" placeholder="sk-..." />
          </div>
          <div class="qb-field-group" style="margin-top: 10px;">
            <label class="qb-field-label" for="qb-openai-model">Model Name</label>
            <input id="qb-openai-model" class="qb-input qb-openai-model" type="text" placeholder="gpt-4o-mini" />
          </div>
          <div class="qb-openai-actions" style="margin-top: 12px; display: flex; gap: 8px;">
            <button class="qb-openai-save-button" type="button">
              Save API Settings
            </button>
          </div>
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
          <div class="qb-field-group qb-field-group-wide qb-image-input-option">
            <label class="qb-check-answer-toggle">
              <input class="qb-image-input-checkbox" type="checkbox" />
              <span>Send cropped image directly to API and skip OCR text</span>
            </label>
            <div class="qb-image-input-note">Requires an OpenAI-compatible vision model.</div>
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
      <section class="qb-settings-appearance">
        <div>
          <div class="qb-card-title">Appearance</div>
          <div class="qb-card-description">Switch between light and dark mode.</div>
        </div>
        <button class="qb-theme-button" type="button" aria-label="Switch theme"></button>
      </section>
    </div>
    <div class="qb-sidebar-body qb-workspace-panel qb-quick-crop-panel qb-hidden" role="tabpanel" data-workspace-panel="quick">
      <div class="qb-solve-hero">
        <div>
          <div class="qb-eyebrow">Question workflow</div>
          <div class="qb-panel-title">Solve a question</div>
          <div class="qb-panel-description">Crop one complete question. QuizBuddy reads it, explains the answer and creates follow-up practice.</div>
        </div>
        <button class="qb-solve-settings" type="button">Configure</button>
      </div>
      <section class="qb-primary-actions">
        <button class="qb-crop-button" type="button">Start screen crop</button>
        <div class="qb-status" role="status" aria-live="polite">Include the full prompt, choices and any diagram.</div>
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
        <div class="qb-ocr-header">
          <h2 class="qb-section-title">OCR Text</h2>
          <div class="qb-ocr-tabs">
            <button type="button" class="qb-ocr-tab active" data-tab="edit">Edit</button>
            <button type="button" class="qb-ocr-tab" data-tab="preview">Preview</button>
          </div>
        </div>
        <div class="qb-ocr-confidence"></div>
        <div class="qb-ocr-container">
          <textarea class="qb-ocr-textarea" rows="8" spellcheck="true"></textarea>
          <div class="qb-ocr-preview qb-hidden"></div>
        </div>
        <button class="qb-analyze-button" type="button">Analyze Question</button>
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
    <div class="qb-chat-panel qb-workspace-panel" role="tabpanel" data-workspace-panel="chat">
      <div class="qb-chat-toolbar">
        <div>
          <div class="qb-eyebrow">Quick conversation</div>
          <div class="qb-chat-title">Ask QuizBuddy</div>
          <div class="qb-chat-model-label"></div>
        </div>
        <button class="qb-chat-clear" type="button">Clear</button>
      </div>
      <div class="qb-chat-messages" aria-live="polite">
        <div class="qb-chat-empty">
          <div class="qb-chat-empty-icon">Q</div>
          <div class="qb-chat-empty-title">What do you want to understand?</div>
          <div class="qb-chat-empty-text">Type a question, or start with content already on this page.</div>
          <div class="qb-chat-starters">
            <button class="qb-chat-start-solve" type="button"><strong>Solve a question</strong><span>Crop a prompt on screen</span></button>
            <button class="qb-chat-start-selection" type="button"><strong>Explain selection</strong><span>Use highlighted text</span></button>
            <button class="qb-chat-start-page" type="button"><strong>Summarize page</strong><span>Use readable page content</span></button>
          </div>
        </div>
      </div>
      <div class="qb-chat-attachment qb-hidden">
        <img class="qb-chat-attachment-image" alt="Attached image preview" />
        <div class="qb-chat-attachment-meta">
          <div class="qb-chat-attachment-name"></div>
          <div class="qb-chat-attachment-note">Image will be sent with your next message.</div>
        </div>
        <button class="qb-chat-attachment-remove" type="button" aria-label="Remove attached image">&times;</button>
      </div>
      <div class="qb-chat-error qb-hidden" role="alert"></div>
      <div class="qb-chat-compose">
        <input class="qb-chat-file-input" type="file" accept="image/png,image/jpeg,image/webp" hidden />
        <button class="qb-chat-attach" type="button" aria-label="Attach image" title="Attach image">+</button>
        <textarea class="qb-chat-input" rows="1" maxlength="12000" placeholder="Ask anything..." aria-label="Chat message"></textarea>
        <button class="qb-chat-send" type="button">Ask</button>
      </div>
      <div class="qb-chat-hint">Enter to send, Shift+Enter for a new line. Paste an image from the clipboard to attach it.</div>
    </div>
    <div class="qb-library-panel qb-workspace-panel qb-hidden" role="tabpanel" data-workspace-panel="library">
      <div class="qb-library-toolbar">
        <div>
          <div class="qb-chat-title">Local Library</div>
          <div class="qb-chat-model-label">Stored in IndexedDB on this device.</div>
        </div>
        <div class="qb-library-toolbar-actions">
          <input class="qb-library-import-input" type="file" accept="application/json" hidden />
          <button class="qb-library-import" type="button">Import</button>
          <button class="qb-library-export" type="button">Export</button>
        </div>
      </div>
      <div class="qb-library-controls">
        <div class="qb-workspace-picker-row">
          <select class="qb-select qb-workspace-picker" aria-label="Active workspace"></select>
          <button class="qb-new-workspace" type="button">New</button>
        </div>
        <input class="qb-input qb-library-search" type="search" placeholder="Search saved artifacts" />
        <select class="qb-select qb-retention-policy" aria-label="Retention policy">
          <option value="session">Session only</option>
          <option value="7-days">Keep 7 days</option>
          <option value="30-days">Keep 30 days</option>
          <option value="forever">Keep forever</option>
        </select>
      </div>
      <div class="qb-library-list"></div>
      <button class="qb-library-clear" type="button">Delete all local workspace data</button>
    </div>
  `;

  shadowRoot.append(floatingButton, sidebar);
  document.documentElement.append(host);

  const closeButton = sidebar.querySelector(".qb-close-button");
  const sidebarResizeHandle = sidebar.querySelector(".qb-sidebar-resize-handle");
  const settingsButton = sidebar.querySelector(".qb-settings-button");
  const settingsBackButton = sidebar.querySelector(".qb-settings-back");
  const solveSettingsButton = sidebar.querySelector(".qb-solve-settings");
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
  const providerSelect = sidebar.querySelector(".qb-provider-select");
  const localSettingsGroup = sidebar.querySelector(".qb-local-settings-group");
  const openaiSettingsGroup = sidebar.querySelector(".qb-openai-settings-group");
  const openaiUrlInput = sidebar.querySelector(".qb-openai-url");
  const openaiKeyInput = sidebar.querySelector(".qb-openai-key");
  const openaiModelInput = sidebar.querySelector(".qb-openai-model");
  const openaiSaveButton = sidebar.querySelector(".qb-openai-save-button");
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
  const imageInputCheckbox = sidebar.querySelector(".qb-image-input-checkbox");
  const imageInputNote = sidebar.querySelector(".qb-image-input-note");
  const userAnswerInput = sidebar.querySelector(".qb-user-answer-input");
  const cropButton = sidebar.querySelector(".qb-crop-button");
  const status = sidebar.querySelector(".qb-status");
  const previewSection = sidebar.querySelector(".qb-preview-section");
  const previewImage = sidebar.querySelector(".qb-preview-image");
  const recropButton = sidebar.querySelector(".qb-recrop-button");
  const ocrSection = sidebar.querySelector(".qb-ocr-section");
  const ocrConfidence = sidebar.querySelector(".qb-ocr-confidence");
  const ocrTextarea = sidebar.querySelector(".qb-ocr-textarea");
  const ocrPreview = sidebar.querySelector(".qb-ocr-preview");
  const ocrTabs = [...sidebar.querySelectorAll(".qb-ocr-tab")];
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
  const workspaceTabs = [...sidebar.querySelectorAll(".qb-workspace-tab")];
  const workspacePanels = [...sidebar.querySelectorAll(".qb-workspace-panel")];
  const chatMessages = sidebar.querySelector(".qb-chat-messages");
  const chatModelLabel = sidebar.querySelector(".qb-chat-model-label");
  const chatClearButton = sidebar.querySelector(".qb-chat-clear");
  const chatFileInput = sidebar.querySelector(".qb-chat-file-input");
  const chatAttachButton = sidebar.querySelector(".qb-chat-attach");
  const chatInput = sidebar.querySelector(".qb-chat-input");
  const chatSendButton = sidebar.querySelector(".qb-chat-send");
  const chatAttachment = sidebar.querySelector(".qb-chat-attachment");
  const chatAttachmentImage = sidebar.querySelector(".qb-chat-attachment-image");
  const chatAttachmentName = sidebar.querySelector(".qb-chat-attachment-name");
  const chatAttachmentRemove = sidebar.querySelector(".qb-chat-attachment-remove");
  const chatError = sidebar.querySelector(".qb-chat-error");
  const chatStartSolveButton = sidebar.querySelector(".qb-chat-start-solve");
  const chatStartSelectionButton = sidebar.querySelector(".qb-chat-start-selection");
  const chatStartPageButton = sidebar.querySelector(".qb-chat-start-page");
  const captureSelectionButton = sidebar.querySelector(".qb-capture-selection");
  const capturePageButton = sidebar.querySelector(".qb-capture-page");
  const captureLastCropButton = sidebar.querySelector(".qb-capture-last-crop");
  const captureQuizButton = sidebar.querySelector(".qb-capture-quiz");
  const knowledgeStatus = sidebar.querySelector(".qb-knowledge-status");
  const contextEditor = sidebar.querySelector(".qb-context-editor");
  const contextTitleInput = sidebar.querySelector(".qb-context-title");
  const contextTextInput = sidebar.querySelector(".qb-context-text");
  const contextSource = sidebar.querySelector(".qb-context-source");
  const addSourceButton = sidebar.querySelector(".qb-add-source");
  const skillSelect = sidebar.querySelector(".qb-skill-select");
  const skillSettingInput = sidebar.querySelector(".qb-skill-setting");
  const runSkillButton = sidebar.querySelector(".qb-run-skill");
  const skillResultSection = sidebar.querySelector(".qb-skill-result");
  const skillResultTitle = sidebar.querySelector(".qb-skill-result-title");
  const skillResultContent = sidebar.querySelector(".qb-skill-result-content");
  const skillResultMeta = sidebar.querySelector(".qb-skill-result-meta");
  const saveArtifactButton = sidebar.querySelector(".qb-save-artifact");
  const knowledgeError = sidebar.querySelector(".qb-knowledge-error");
  const librarySearch = sidebar.querySelector(".qb-library-search");
  const workspacePicker = sidebar.querySelector(".qb-workspace-picker");
  const newWorkspaceButton = sidebar.querySelector(".qb-new-workspace");
  const retentionPolicySelect = sidebar.querySelector(".qb-retention-policy");
  const libraryList = sidebar.querySelector(".qb-library-list");
  const libraryExportButton = sidebar.querySelector(".qb-library-export");
  const libraryImportButton = sidebar.querySelector(".qb-library-import");
  const libraryImportInput = sidebar.querySelector(".qb-library-import-input");
  const libraryClearButton = sidebar.querySelector(".qb-library-clear");
  const profileLanguage = sidebar.querySelector(".qb-profile-language");
  const profileOccupation = sidebar.querySelector(".qb-profile-occupation");
  const profileExpertise = sidebar.querySelector(".qb-profile-expertise");
  const profileTone = sidebar.querySelector(".qb-profile-tone");
  const profileFormat = sidebar.querySelector(".qb-profile-format");
  const profileSaveButton = sidebar.querySelector(".qb-profile-save");
  const memoryLabelInput = sidebar.querySelector(".qb-memory-label");
  const memoryValueInput = sidebar.querySelector(".qb-memory-value");
  const memorySaveButton = sidebar.querySelector(".qb-memory-save");
  const memoryList = sidebar.querySelector(".qb-memory-list");
  const customSkillNameInput = sidebar.querySelector(".qb-custom-skill-name");
  const customSkillDescriptionInput = sidebar.querySelector(
    ".qb-custom-skill-description"
  );
  const customSkillInstructionInput = sidebar.querySelector(
    ".qb-custom-skill-instruction"
  );
  const customSkillOutputSelect = sidebar.querySelector(".qb-custom-skill-output");
  const customSkillInputSelect = sidebar.querySelector(".qb-custom-skill-input");
  const customSkillSaveButton = sidebar.querySelector(".qb-custom-skill-save");

  ocrTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      ocrTabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      
      const mode = tab.dataset.tab;
      if (mode === "preview") {
        ocrTextarea.classList.add("qb-hidden");
        ocrPreview.classList.remove("qb-hidden");
        
        const rawContent = ocrTextarea.value.trim();
        const content = expandFormulasForPrompt(rawContent, currentFormulas);
        ocrPreview.replaceChildren();
        if (containsLatexMarkers(content)) {
          ocrPreview.appendChild(renderTextWithFormulas(content));
          // Apply entering class to any formula nodes inside the preview for fade-in effect
          ocrPreview.querySelectorAll(".qb-formula").forEach((el) => {
            el.classList.add("qb-formula-entering");
          });
        } else {
          ocrPreview.textContent = rawContent || "No text available";
        }
      } else {
        ocrPreview.classList.add("qb-hidden");
        ocrTextarea.classList.remove("qb-hidden");
        ocrTextarea.focus();
      }
    });
  });

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
  sidebarResizeHandle.addEventListener("pointerdown", startSidebarResize);
  sidebarResizeHandle.addEventListener("pointermove", resizeSidebar);
  sidebarResizeHandle.addEventListener("pointerup", finishSidebarResize);
  sidebarResizeHandle.addEventListener("pointercancel", finishSidebarResize);
  sidebarResizeHandle.addEventListener("dblclick", resetSidebarWidth);
  sidebarResizeHandle.addEventListener("keydown", resizeSidebarWithKeyboard);
  settingsButton.addEventListener("click", () => switchWorkspaceTab("settings"));
  settingsBackButton.addEventListener("click", () => switchWorkspaceTab("chat"));
  solveSettingsButton.addEventListener("click", () => switchWorkspaceTab("settings"));
  themeButton.addEventListener("click", toggleTheme);
  providerSelect.addEventListener("change", onProviderChange);
  openaiSaveButton.addEventListener("click", onOpenaiSaveSettings);

  cropButton.addEventListener("click", startCropMode);
  analyzeButton.addEventListener("click", () => analyzeEditedOCRText(false));
  modelDownloadButton.addEventListener("click", () => {
    prepareLocalModel();
  });
  modelLaterButton.addEventListener("click", postponeModelDownload);
  modelDeleteButton.addEventListener("click", deleteSelectedModel);
  modelSelect.addEventListener("change", onModelSelectionChange);
  ocrLanguageSelect.addEventListener("change", onOCRLanguageChange);
  imageInputCheckbox.addEventListener("change", onAnalysisInputModeChange);
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
  workspaceTabs.forEach((tab) =>
    tab.addEventListener("click", () => switchWorkspaceTab(tab.dataset.workspaceTab))
  );
  chatClearButton.addEventListener("click", clearChat);
  chatAttachButton.addEventListener("click", () => chatFileInput.click());
  chatFileInput.addEventListener("change", onChatFileSelected);
  chatAttachmentRemove.addEventListener("click", clearPendingChatImage);
  chatSendButton.addEventListener("click", sendChatMessage);
  chatInput.addEventListener("input", resizeChatInput);
  chatInput.addEventListener("paste", onChatPaste);
  chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendChatMessage();
    }
  });
  chatStartSolveButton.addEventListener("click", () => switchWorkspaceTab("quick"));
  chatStartSelectionButton.addEventListener("click", () => {
    switchWorkspaceTab("capture");
    captureSelectedText();
  });
  chatStartPageButton.addEventListener("click", () => {
    switchWorkspaceTab("capture");
    captureCurrentPage();
  });
  captureSelectionButton.addEventListener("click", captureSelectedText);
  capturePageButton.addEventListener("click", captureCurrentPage);
  captureLastCropButton.addEventListener("click", captureLastQuizCrop);
  captureQuizButton.addEventListener("click", () => switchWorkspaceTab("quick"));
  contextTitleInput.addEventListener("input", syncKnowledgeContextEditor);
  contextTextInput.addEventListener("input", syncKnowledgeContextEditor);
  addSourceButton.addEventListener("click", addCurrentSourceToWorkspace);
  skillSelect.addEventListener("change", updateSkillSettingHint);
  runSkillButton.addEventListener("click", runSelectedKnowledgeSkill);
  saveArtifactButton.addEventListener("click", saveCurrentArtifact);
  librarySearch.addEventListener("input", renderLibrary);
  workspacePicker.addEventListener("change", selectWorkspace);
  newWorkspaceButton.addEventListener("click", createNewWorkspace);
  retentionPolicySelect.addEventListener("change", updateRetentionPolicy);
  libraryExportButton.addEventListener("click", exportCurrentWorkspace);
  libraryImportButton.addEventListener("click", () => libraryImportInput.click());
  libraryImportInput.addEventListener("change", importWorkspaceFile);
  libraryClearButton.addEventListener("click", clearWorkspaceData);
  profileSaveButton.addEventListener("click", saveKnowledgeProfile);
  memorySaveButton.addEventListener("click", saveExplicitMemory);
  customSkillSaveButton.addEventListener("click", saveCustomSkill);
  floatingButton.addEventListener("pointerdown", onFloatingPointerDown);
  floatingButton.addEventListener("pointermove", onFloatingPointerMove);
  floatingButton.addEventListener("pointerup", onFloatingPointerUp);
  floatingButton.addEventListener("pointercancel", resetFloatingPointer);
  window.addEventListener("pagehide", releaseLocalResources);
  window.addEventListener("resize", applySidebarWidth);
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
        "Processing the crop. The first run may take longer while the model or API responds.",
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
      if (typeof message.chatText === "string") {
        renderStreamingChatText(message.chatText);
      } else if (typeof message.skillText === "string") {
        renderStreamingSkillText(message.skillText);
      } else {
        renderPartialResult(message);
      }
    }

    if (
      message.type === "QB_PROCESS_RAW_AI" &&
      (message.taskId || message.requestId) === activeRequestId
    ) {
      console.info(
        `[QuizBuddy raw AI] ${message.label} (${message.rawLength} chars)\n${message.content}${message.truncated ? `\n...[truncated ${message.truncated} chars]` : ""}`
      );
    }
  });

  async function startCropFromShortcut() {
    await ensureModelOnboarding();
    if (modelReady) {
      switchWorkspaceTab("quick");
      startCropMode();
    }
  }

  function switchWorkspaceTab(tabName) {
    selectedWorkspaceTab = ["capture", "quick", "chat", "library", "settings"].includes(tabName)
      ? tabName
      : "chat";
    workspaceTabs.forEach((tab) => {
      const selected = tab.dataset.workspaceTab === selectedWorkspaceTab;
      tab.classList.toggle("qb-workspace-tab-active", selected);
      tab.setAttribute("aria-selected", String(selected));
    });
    settingsButton.classList.toggle(
      "qb-settings-button-active",
      selectedWorkspaceTab === "settings"
    );
    settingsButton.setAttribute(
      "aria-pressed",
      String(selectedWorkspaceTab === "settings")
    );
    workspacePanels.forEach((panel) => {
      panel.classList.toggle(
        "qb-hidden",
        panel.dataset.workspacePanel !== selectedWorkspaceTab
      );
    });
    if (selectedWorkspaceTab === "chat") {
      updateChatProviderState();
      chatInput.focus();
      chatMessages.scrollTop = chatMessages.scrollHeight;
    } else if (selectedWorkspaceTab === "library") {
      renderLibrary();
    }
  }

  function captureSelectedText() {
    const text = String(window.getSelection()?.toString() || "").trim();
    if (!text) {
      showKnowledgeError("Select text on the page before using this action.");
      return;
    }
    setKnowledgeContext({
      type: "selection",
      title: `Selection from ${document.title || location.hostname}`,
      text,
      source: {
        url: location.href,
        pageTitle: document.title,
        capturedAt: new Date().toISOString()
      },
      metadata: { characterCount: text.length }
    });
  }

  function captureCurrentPage() {
    const clone = document.body.cloneNode(true);
    clone
      .querySelectorAll("script, style, noscript, nav, header, footer, form")
      .forEach((element) => element.remove());
    const text = String(clone.innerText || clone.textContent || "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, 120000);
    if (!text) {
      showKnowledgeError("No readable page content was found.");
      return;
    }
    setKnowledgeContext({
      type: "page",
      title: document.title || location.hostname,
      text,
      source: {
        url: location.href,
        pageTitle: document.title,
        capturedAt: new Date().toISOString()
      },
      metadata: { characterCount: text.length }
    });
  }

  function captureLastQuizCrop() {
    if (!lastAnalysisContext?.ocrText) {
      showKnowledgeError(
        "Complete a Quiz crop first, then return here to transform its context."
      );
      return;
    }
    setKnowledgeContext({
      type: "crop",
      title: `Crop from ${document.title || location.hostname}`,
      text: lastAnalysisContext.ocrText,
      imageDataUrl: lastAnalysisContext.croppedImageDataUrl || "",
      source: {
        url: location.href,
        pageTitle: document.title,
        capturedAt: new Date().toISOString()
      },
      metadata: { inputMode: lastAnalysisContext.inputMode || "ocr" }
    });
  }

  function setKnowledgeContext(input) {
    try {
      currentKnowledgeContext = createContextItem(input);
      const duplicateIndex = knowledgeContexts.findIndex(
        (item) =>
          item.source.url === currentKnowledgeContext.source.url &&
          item.text === currentKnowledgeContext.text
      );
      if (duplicateIndex >= 0) {
        knowledgeContexts[duplicateIndex] = currentKnowledgeContext;
      } else {
        knowledgeContexts.push(currentKnowledgeContext);
        knowledgeContexts = knowledgeContexts.slice(-12);
      }
      currentSkillResult = null;
      contextTitleInput.value = currentKnowledgeContext.title;
      contextTextInput.value = currentKnowledgeContext.text;
      contextSource.textContent = `${
        currentKnowledgeContext.source.url || "Local context"
      } · ${knowledgeContexts.length} source(s) in this research session`;
      contextEditor.classList.remove("qb-hidden");
      skillResultSection.classList.add("qb-hidden");
      runSkillButton.disabled = false;
      knowledgeStatus.textContent = `${currentKnowledgeContext.text.length.toLocaleString()} characters captured. Review the context before running a skill.`;
      clearKnowledgeError();
      updateSkillSettingHint();
    } catch (error) {
      showKnowledgeError(error.message);
    }
  }

  function syncKnowledgeContextEditor() {
    if (!currentKnowledgeContext) return;
    currentKnowledgeContext = {
      ...currentKnowledgeContext,
      title: contextTitleInput.value.trim() || currentKnowledgeContext.title,
      text: contextTextInput.value
    };
    knowledgeContexts = knowledgeContexts.map((item) =>
      item.id === currentKnowledgeContext.id ? currentKnowledgeContext : item
    );
    runSkillButton.disabled = !currentKnowledgeContext.text.trim();
    currentSkillResult = null;
    skillResultSection.classList.add("qb-hidden");
  }

  function updateSkillSettingHint() {
    const hints = {
      quiz: "quick or learning",
      explain: "beginner, professional, or expert",
      summarize: "brief, bullets, or executive",
      extract: "facts, entities, tasks, dates, or table",
      rewrite: "concise, professional, friendly, or persuasive",
      translate: "Target language, for example Vietnamese",
      ask: "Question to answer from this context",
      "research-brief": "Research objective",
      "decision-matrix": "Decision criteria",
      "action-checklist": "Objective for the reviewable checklist"
    };
    skillSettingInput.placeholder = hints[skillSelect.value] || "Optional";
  }

  async function runSelectedKnowledgeSkill() {
    if (!currentKnowledgeContext?.text.trim() || activeRequestId) return;
    await ensureModelOnboarding();
    if (!modelReady) {
      showKnowledgeError("Prepare a local model or configure the API provider.");
      return;
    }

    syncKnowledgeContextEditor();
    const skillId = skillSelect.value;
    const isResearchSkill = [
      "compare-sources",
      "agreements-contradictions",
      "research-brief",
      "decision-matrix"
    ].includes(skillId);
    if (isResearchSkill && currentWorkspace?.contextIds?.length) {
      const storedContexts = (
        await Promise.all(
          currentWorkspace.contextIds.map((id) =>
            workspaceStore.get("contexts", id)
          )
        )
      ).filter(Boolean);
      const contextById = new Map(
        [...storedContexts, ...knowledgeContexts].map((item) => [item.id, item])
      );
      knowledgeContexts = [...contextById.values()].slice(-12);
    }
    const skillContexts = isResearchSkill
      ? knowledgeContexts
      : [currentKnowledgeContext];
    const enabledMemories = (await workspaceStore.getAll("memories")).filter(
      (memory) => memory.enabled !== false
    );
    const taskProfile = {
      ...userProfile,
      memory: enabledMemories
        .map((memory) => `${memory.label}: ${memory.value}`)
        .join("; ")
        .slice(0, 2000)
    };
    const settings = getKnowledgeSkillSettings(skillId, skillSettingInput.value);
    const runSignature = `${skillId}:${skillContexts.map((item) => item.id).join(",")}`;
    if (runSignature === lastKnowledgeRunSignature) {
      recordLocalMetric({
        name: "skill_retried",
        skillId,
        provider: selectedProvider,
        success: true
      });
    }
    lastKnowledgeRunSignature = runSignature;
    activeRequestId = crypto.randomUUID();
    activeKnowledgeSkillId = skillId;
    const taskId = activeRequestId;
    const startedAt = performance.now();
    currentSkillResult = null;
    skillResultTitle.textContent = `${skillRegistry.get(skillId)?.name || "Skill"} result`;
    skillResultContent.textContent = "Working...";
    skillResultMeta.textContent = "";
    skillResultSection.classList.remove("qb-hidden");
    saveArtifactButton.disabled = true;
    clearKnowledgeError();
    setProcessingState(true);
    recordLocalMetric({
      name: "skill_started",
      skillId,
      provider: selectedProvider,
      success: true
    });

    try {
      const response = await chrome.runtime.sendMessage({
        type: "QB_RUN_SKILL",
        protocolVersion: 1,
        taskId,
        skillId,
        context: skillContexts,
        settings,
        profile: taskProfile,
        customSkills,
        provider: selectedProvider,
        modelId: selectedModelId,
        openaiBaseUrl: selectedOpenaiBaseUrl,
        openaiApiKey: selectedOpenaiApiKey,
        openaiModel: selectedOpenaiModel
      });
      if (activeRequestId !== taskId) return;
      if (!response?.ok) {
        throw new Error(response?.error || "Could not run this skill.");
      }
      currentSkillResult = response;
      if (response.actionProposal) {
        renderActionProposal(response.actionProposal);
      } else {
        renderStreamingSkillText(response.content);
      }
      const warnings = [];
      if (response.invalidSourceRefs?.length) {
        warnings.push("Removed or unverified source references were detected.");
      }
      if (response.omittedSourceIds?.length) {
        warnings.push(`${response.omittedSourceIds.length} source(s) exceeded the context limit.`);
      }
      renderSkillSourceRefs(response.sourceRefs || [], warnings);
      saveArtifactButton.disabled = false;
      recordLocalMetric({
        name: "skill_completed",
        skillId,
        provider: selectedProvider,
        durationMs: performance.now() - startedAt,
        success: true
      });
    } catch (error) {
      showKnowledgeError(error.message);
      skillResultContent.textContent = "The skill did not produce a usable result.";
      recordLocalMetric({
        name: "skill_failed",
        skillId,
        provider: selectedProvider,
        durationMs: performance.now() - startedAt,
        success: false
      });
    } finally {
      if (activeRequestId === taskId) {
        activeRequestId = null;
        activeKnowledgeSkillId = "";
        setProcessingState(false);
        scheduleResourceRelease();
      }
    }
  }

  function getKnowledgeSkillSettings(skillId, value) {
    const normalized = String(value || "").trim();
    const defaults = {
      quiz: ["mode", "learning"],
      explain: ["level", "beginner"],
      summarize: ["style", "brief"],
      extract: ["target", "facts"],
      rewrite: ["tone", "professional"],
      translate: ["language", "Vietnamese"],
      ask: ["question", "What are the key points?"],
      "research-brief": ["objective", "Summarize the evidence and open questions."],
      "decision-matrix": ["criteria", "Cost, quality, risk, and time"],
      "action-checklist": ["objective", "Create a manual review checklist."]
    };
    const [key, fallback] = defaults[skillId] || ["objective", ""];
    return { [key]: normalized || fallback };
  }

  function renderStreamingSkillText(text) {
    skillResultContent.replaceChildren(renderMarkdown(text));
  }

  function renderActionProposal(proposal) {
    const container = createElement("div", "qb-action-proposal");
    container.append(
      createElement("div", "qb-action-title", proposal.title),
      createElement("div", "qb-action-summary", proposal.summary)
    );
    const steps = createElement("ol", "qb-action-steps");
    for (const step of proposal.steps) {
      const item = document.createElement("li");
      item.textContent = `${step.label}${step.value ? `: ${step.value}` : ""} (${step.risk} risk)`;
      steps.append(item);
    }
    container.append(steps);
    if (proposal.risks.length) {
      container.append(
        createElement(
          "div",
          "qb-action-risks",
          `Risks to review: ${proposal.risks.join("; ")}`
        )
      );
    }
    const notice = createElement(
      "div",
      "qb-action-notice",
      "Review only. QuizBuddy Labs will not click, submit, pay, or send anything."
    );
    const actions = createElement("div", "qb-action-review-actions");
    const accept = createElement("button", "qb-action-accept", "Accept Draft");
    const reject = createElement("button", "qb-action-reject", "Reject");
    accept.addEventListener("click", () =>
      reviewActionProposal("accepted", notice, actions)
    );
    reject.addEventListener("click", () =>
      reviewActionProposal("rejected", notice, actions)
    );
    actions.append(accept, reject);
    container.append(notice, actions);
    skillResultContent.replaceChildren(container);
  }

  function reviewActionProposal(status, notice, actions) {
    if (!currentSkillResult?.actionProposal) return;
    currentSkillResult.actionProposal = {
      ...currentSkillResult.actionProposal,
      status
    };
    notice.textContent =
      status === "accepted"
        ? "Draft accepted for manual use. No website action was executed."
        : "Draft rejected. No website action was executed.";
    actions.remove();
  }

  function renderSkillSourceRefs(sourceRefs, warnings = []) {
    skillResultMeta.replaceChildren();
    if (warnings.length) {
      skillResultMeta.append(
        createElement("div", "qb-source-warning", warnings.join(" "))
      );
    }
    if (!sourceRefs.length) {
      skillResultMeta.append(
        createElement("div", "", "No explicit source references were returned.")
      );
      return;
    }
    const sourceById = new Map(
      knowledgeContexts.map((context) => [context.id, context])
    );
    const label = createElement("span", "", "Verified sources: ");
    skillResultMeta.append(label);
    for (const sourceId of sourceRefs) {
      const context = sourceById.get(sourceId);
      if (!context) continue;
      const button = createElement(
        "button",
        "qb-source-ref",
        context.title || sourceId
      );
      button.type = "button";
      button.addEventListener("click", () => setKnowledgeContext(context));
      skillResultMeta.append(button);
    }
  }

  async function saveCurrentArtifact() {
    if (!currentKnowledgeContext || !currentSkillResult) return;
    try {
      await ensureCurrentWorkspace();
      const resultContexts = ([
        "compare-sources",
        "agreements-contradictions",
        "research-brief",
        "decision-matrix"
      ].includes(currentSkillResult.skillId)
        ? knowledgeContexts
        : [currentKnowledgeContext]
      ).map((item) => stripTransientContext(item));
      const artifact = createArtifact({
        workspaceId: currentWorkspace.id,
        skillId: currentSkillResult.skillId,
        title: currentSkillResult.title,
        content: currentSkillResult.content,
        format: currentSkillResult.format,
        sourceRefs: resultContexts.map((item) => item.id),
        provider: selectedProvider,
        metadata: {
          verifiedSourceRefs: currentSkillResult.sourceRefs || [],
          invalidSourceRefs: currentSkillResult.invalidSourceRefs || []
        }
      });
      currentWorkspace = createWorkspace({
        ...currentWorkspace,
        contextIds: [
          ...currentWorkspace.contextIds,
          ...resultContexts.map((item) => item.id)
        ],
        artifactIds: [...currentWorkspace.artifactIds, artifact.id],
        updatedAt: new Date().toISOString()
      });

      await Promise.all([
        ...resultContexts.map((context) =>
          workspaceStore.put("contexts", context)
        ),
        workspaceStore.put("artifacts", artifact),
        workspaceStore.put("workspaces", currentWorkspace)
      ]);
      saveArtifactButton.disabled = true;
      saveArtifactButton.textContent = "Saved";
      knowledgeStatus.textContent = "Artifact saved to the local Library.";
      recordLocalMetric({
        name: "artifact_saved",
        skillId: artifact.skillId,
        provider: artifact.provider,
        success: true
      });
    } catch (error) {
      showKnowledgeError(`Could not save artifact: ${error.message}`);
    }
  }

  async function addCurrentSourceToWorkspace() {
    if (!currentKnowledgeContext?.text.trim()) return;
    try {
      syncKnowledgeContextEditor();
      await ensureCurrentWorkspace();
      const context = stripTransientContext(currentKnowledgeContext);
      currentWorkspace = createWorkspace({
        ...currentWorkspace,
        contextIds: [...currentWorkspace.contextIds, context.id],
        updatedAt: new Date().toISOString()
      });
      await Promise.all([
        workspaceStore.put("contexts", context),
        workspaceStore.put("workspaces", currentWorkspace)
      ]);
      addSourceButton.textContent = "Source Added";
      knowledgeStatus.textContent = `${currentWorkspace.contextIds.length} source(s) are available in this workspace across tabs.`;
    } catch (error) {
      showKnowledgeError(`Could not add source: ${error.message}`);
    }
  }

  async function ensureCurrentWorkspace() {
    if (currentWorkspace) {
      const latest = await workspaceStore.get(
        "workspaces",
        currentWorkspace.id
      );
      if (latest) currentWorkspace = latest;
      return currentWorkspace;
    }
    currentWorkspace = createWorkspace({
      title:
        currentKnowledgeContext?.source?.pageTitle || "Knowledge workspace"
    });
    await workspaceStore.put("workspaces", currentWorkspace);
    if (retentionPolicy !== "session") {
      await chrome.storage.local.set({
        [ACTIVE_WORKSPACE_KEY]: currentWorkspace.id
      });
    }
    return currentWorkspace;
  }

  async function renderLibrary() {
    try {
      const workspaces = (await workspaceStore.getAll("workspaces")).filter(
        (item) => item.id !== "__schema__"
      );
      workspacePicker.replaceChildren(
        ...workspaces.map((workspace) => {
          const option = document.createElement("option");
          option.value = workspace.id;
          option.textContent = workspace.title;
          return option;
        })
      );
      if (currentWorkspace) workspacePicker.value = currentWorkspace.id;
      const artifacts = searchWorkspaceRecords(
        (await workspaceStore.getAll("artifacts")).filter(
          (item) => item.id !== "__schema__"
        ).filter(
          (item) =>
            !currentWorkspace || item.workspaceId === currentWorkspace.id
        ),
        librarySearch.value
      );
      const workspaceContextIds = new Set(currentWorkspace?.contextIds || []);
      const contexts = searchWorkspaceRecords(
        (await workspaceStore.getAll("contexts")).filter(
          (item) => !currentWorkspace || workspaceContextIds.has(item.id)
        ),
        librarySearch.value
      );
      libraryList.replaceChildren();
      if (!artifacts.length && !contexts.length) {
        libraryList.append(
          createElement("div", "qb-library-empty", "No saved sources or artifacts yet.")
        );
        return;
      }
      if (contexts.length) {
        libraryList.append(
          createElement("div", "qb-library-group-title", "Sources")
        );
      }
      for (const context of contexts) {
        const item = createElement("article", "qb-library-item");
        const heading = createElement("div", "qb-library-item-heading");
        heading.append(
          createElement("div", "qb-library-item-title", context.title),
          createElement("div", "qb-library-item-date", context.type)
        );
        const preview = createElement(
          "div",
          "qb-library-item-preview",
          context.text.slice(0, 320)
        );
        const actions = createElement("div", "qb-library-item-actions");
        for (const [label, handler] of [
          ["Continue", () => continueFromContext(context)],
          ["Delete", () => deleteContext(context)]
        ]) {
          const button = createElement("button", "qb-library-item-button", label);
          button.type = "button";
          button.addEventListener("click", handler);
          actions.append(button);
        }
        item.append(heading, preview, actions);
        libraryList.append(item);
      }
      if (artifacts.length) {
        libraryList.append(
          createElement("div", "qb-library-group-title", "Artifacts")
        );
      }
      for (const artifact of artifacts) {
        const item = createElement("article", "qb-library-item");
        const heading = createElement("div", "qb-library-item-heading");
        heading.append(
          createElement("div", "qb-library-item-title", artifact.title),
          createElement(
            "div",
            "qb-library-item-date",
            new Date(artifact.updatedAt).toLocaleString()
          )
        );
        const preview = createElement(
          "div",
          "qb-library-item-preview",
          artifact.content.slice(0, 320)
        );
        const actions = createElement("div", "qb-library-item-actions");
        for (const [label, handler] of [
          ["Continue", () => continueFromArtifact(artifact)],
          [artifact.pinned ? "Unpin" : "Pin", () => toggleArtifactPin(artifact)],
          ["Rename", () => renameArtifact(artifact)],
          ["Duplicate", () => duplicateArtifact(artifact)],
          ["Delete", () => deleteArtifact(artifact)]
        ]) {
          const button = createElement("button", "qb-library-item-button", label);
          button.type = "button";
          button.addEventListener("click", handler);
          actions.append(button);
        }
        item.append(heading, preview, actions);
        libraryList.append(item);
      }
    } catch (error) {
      libraryList.replaceChildren(
        createElement("div", "qb-knowledge-error", error.message)
      );
    }
  }

  async function selectWorkspace() {
    const workspace = await workspaceStore.get(
      "workspaces",
      workspacePicker.value
    );
    if (!workspace) return;
    currentWorkspace = workspace;
    knowledgeContexts = (
      await Promise.all(
        workspace.contextIds.map((id) => workspaceStore.get("contexts", id))
      )
    ).filter(Boolean);
    if (retentionPolicy !== "session") {
      await chrome.storage.local.set({
        [ACTIVE_WORKSPACE_KEY]: workspace.id
      });
    }
    renderLibrary();
  }

  async function createNewWorkspace() {
    const title = window.prompt("Workspace name", "New workspace")?.trim();
    if (!title) return;
    currentWorkspace = createWorkspace({ title });
    knowledgeContexts = [];
    await workspaceStore.put("workspaces", currentWorkspace);
    if (retentionPolicy !== "session") {
      await chrome.storage.local.set({
        [ACTIVE_WORKSPACE_KEY]: currentWorkspace.id
      });
    }
    renderLibrary();
  }

  async function toggleArtifactPin(artifact) {
    await workspaceStore.put("artifacts", {
      ...artifact,
      pinned: !artifact.pinned,
      updatedAt: new Date().toISOString()
    });
    renderLibrary();
  }

  function continueFromArtifact(artifact) {
    setKnowledgeContext({
      type: "artifact",
      title: artifact.title,
      text: artifact.content,
      source: {
        capturedAt: artifact.updatedAt || artifact.createdAt
      },
      metadata: {
        artifactId: artifact.id,
        sourceRefs: artifact.sourceRefs || []
      }
    });
    switchWorkspaceTab("capture");
  }

  function continueFromContext(context) {
    setKnowledgeContext(context);
    switchWorkspaceTab("capture");
  }

  async function deleteContext(context) {
    const artifacts = await workspaceStore.getAll("artifacts");
    await Promise.all(
      artifacts
        .filter((artifact) => artifact.sourceRefs?.includes(context.id))
        .map((artifact) =>
          workspaceStore.put("artifacts", {
            ...artifact,
            sourceRefs: artifact.sourceRefs.filter((id) => id !== context.id),
            updatedAt: new Date().toISOString()
          })
        )
    );
    await workspaceStore.delete("contexts", context.id);
    if (currentWorkspace) {
      currentWorkspace = createWorkspace({
        ...currentWorkspace,
        contextIds: currentWorkspace.contextIds.filter(
          (id) => id !== context.id
        ),
        updatedAt: new Date().toISOString()
      });
      await workspaceStore.put("workspaces", currentWorkspace);
    }
    knowledgeContexts = knowledgeContexts.filter(
      (item) => item.id !== context.id
    );
    renderLibrary();
  }

  async function renameArtifact(artifact) {
    const title = window.prompt("Artifact title", artifact.title)?.trim();
    if (!title) return;
    await workspaceStore.put("artifacts", {
      ...artifact,
      title: title.slice(0, 160),
      updatedAt: new Date().toISOString()
    });
    renderLibrary();
  }

  async function duplicateArtifact(artifact) {
    const duplicate = createArtifact({
      ...artifact,
      id: "",
      title: `${artifact.title} copy`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    await workspaceStore.put("artifacts", duplicate);
    renderLibrary();
  }

  async function deleteArtifact(artifact) {
    await workspaceStore.delete("artifacts", artifact.id);
    renderLibrary();
  }

  async function updateRetentionPolicy() {
    retentionPolicy = retentionPolicySelect.value;
    await chrome.storage.local.set({ [RETENTION_POLICY_KEY]: retentionPolicy });
    if (retentionPolicy === "session") {
      workspaceStore = new WorkspaceStore({ sessionOnly: true });
    } else {
      workspaceStore = createPersistentWorkspaceClient();
      await workspaceStore.applyRetention(retentionPolicy);
    }
    currentWorkspace = null;
    renderLibrary();
  }

  async function exportCurrentWorkspace() {
    const [workspaces, contexts, artifacts, memories, customSkills] =
      await Promise.all([
        workspaceStore.getAll("workspaces"),
        workspaceStore.getAll("contexts"),
        workspaceStore.getAll("artifacts"),
        workspaceStore.getAll("memories"),
        workspaceStore.getAll("customSkills")
      ]);
    const bundle = exportWorkspaceBundle({
      workspaces: workspaces.filter((item) => item.id !== "__schema__"),
      contexts,
      artifacts,
      memories,
      customSkills
    });
    recordLocalMetric({
      name: "workspace_exported",
      provider: selectedProvider,
      success: true
    });
    downloadTextFile(
      `quizbuddy-labs-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(bundle, null, 2),
      "application/json"
    );
    if (currentWorkspace) {
      const markdown = toMarkdownExport(
        currentWorkspace,
        contexts,
        artifacts.filter((item) => item.workspaceId === currentWorkspace.id)
      );
      downloadTextFile("quizbuddy-labs-workspace.md", markdown, "text/markdown");
    }
  }

  async function importWorkspaceFile() {
    const [file] = libraryImportInput.files || [];
    libraryImportInput.value = "";
    if (!file) return;
    try {
      const bundle = importWorkspaceBundle(JSON.parse(await file.text()));
      for (const [storeName, records] of Object.entries({
        workspaces: bundle.workspaces,
        contexts: bundle.contexts,
        artifacts: bundle.artifacts,
        memories: bundle.memories,
        customSkills: bundle.customSkills
      })) {
        for (const record of records) {
          if (record.id) await workspaceStore.put(storeName, record);
        }
      }
      renderLibrary();
    } catch (error) {
      libraryList.prepend(
        createElement(
          "div",
          "qb-knowledge-error",
          `Import failed: ${error.message}`
        )
      );
    }
  }

  function downloadTextFile(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function createPersistentWorkspaceClient() {
    const run = async (operation, payload = {}) => {
      const response = await chrome.runtime.sendMessage({
        type: "QB_WORKSPACE_OP",
        operation,
        ...payload
      });
      if (!response?.ok) {
        throw new Error(response?.error || "Workspace operation failed.");
      }
      return response.result;
    };
    return {
      put: (storeName, record) => run("put", { storeName, record }),
      get: (storeName, id) => run("get", { storeName, id }),
      getAll: (storeName) => run("getAll", { storeName }),
      delete: (storeName, id) => run("delete", { storeName, id }),
      clearAll: () => run("clearAll"),
      applyRetention: (policy) => run("applyRetention", { policy })
    };
  }

  function recordLocalMetric(input) {
    const event = createMetricEvent(input);
    workspaceStore.put("metrics", event).catch(() => {});
  }

  async function clearWorkspaceData() {
    if (!window.confirm("Delete all locally saved QuizBuddy Labs workspace data?")) {
      return;
    }
    await workspaceStore.clearAll();
    currentWorkspace = null;
    renderLibrary();
  }

  async function saveKnowledgeProfile() {
    userProfile = {
      language: profileLanguage.value.trim().slice(0, 100),
      occupation: profileOccupation.value.trim().slice(0, 100),
      expertise: profileExpertise.value.trim().slice(0, 100),
      tone: profileTone.value.trim().slice(0, 100),
      format: profileFormat.value.trim().slice(0, 100)
    };
    await chrome.storage.local.set({ [PROFILE_KEY]: userProfile });
    knowledgeStatus.textContent = "Local profile saved.";
  }

  function applyKnowledgeProfileToUI() {
    profileLanguage.value = userProfile.language || "";
    profileOccupation.value = userProfile.occupation || "";
    profileExpertise.value = userProfile.expertise || "";
    profileTone.value = userProfile.tone || "";
    profileFormat.value = userProfile.format || "";
  }

  async function saveExplicitMemory() {
    const label = memoryLabelInput.value.trim();
    const value = memoryValueInput.value.trim();
    if (!label || !value) {
      showKnowledgeError("Memory requires both a label and a value.");
      return;
    }
    const now = new Date().toISOString();
    await workspaceStore.put("memories", {
      id: `mem_${crypto.randomUUID()}`,
      label: label.slice(0, 120),
      value: value.slice(0, 2000),
      enabled: true,
      createdAt: now,
      updatedAt: now
    });
    memoryLabelInput.value = "";
    memoryValueInput.value = "";
    await renderMemories();
  }

  async function renderMemories() {
    const memories = await workspaceStore.getAll("memories");
    memoryList.replaceChildren();
    for (const memory of memories) {
      const row = createElement("div", "qb-memory-item");
      const text = createElement(
        "div",
        "qb-memory-text",
        `${memory.label}: ${memory.value}`
      );
      const toggle = createElement(
        "button",
        "qb-library-item-button",
        memory.enabled === false ? "Enable" : "Disable"
      );
      toggle.addEventListener("click", async () => {
        await workspaceStore.put("memories", {
          ...memory,
          enabled: memory.enabled === false,
          updatedAt: new Date().toISOString()
        });
        renderMemories();
      });
      const edit = createElement("button", "qb-library-item-button", "Edit");
      edit.addEventListener("click", async () => {
        const value = window.prompt("Memory value", memory.value)?.trim();
        if (!value) return;
        await workspaceStore.put("memories", {
          ...memory,
          value: value.slice(0, 2000),
          updatedAt: new Date().toISOString()
        });
        renderMemories();
      });
      const remove = createElement("button", "qb-library-item-button", "Delete");
      remove.addEventListener("click", async () => {
        await workspaceStore.delete("memories", memory.id);
        renderMemories();
      });
      row.append(text, toggle, edit, remove);
      memoryList.append(row);
    }
  }

  async function saveCustomSkill() {
    try {
      const skill = normalizeCustomSkill({
        id: customSkillNameInput.value,
        name: customSkillNameInput.value,
        description: customSkillDescriptionInput.value,
        instruction: customSkillInstructionInput.value,
        acceptedContextTypes: customSkillInputSelect.value.split(","),
        outputType: customSkillOutputSelect.value
      });
      await workspaceStore.put("customSkills", skill);
      customSkills = await workspaceStore.getAll("customSkills");
      rebuildSkillRegistry();
      customSkillNameInput.value = "";
      customSkillDescriptionInput.value = "";
      customSkillInstructionInput.value = "";
      knowledgeStatus.textContent = `${skill.name} added as a declarative local skill.`;
    } catch (error) {
      showKnowledgeError(error.message);
    }
  }

  function rebuildSkillRegistry() {
    skillRegistry = createSkillRegistry(customSkills);
    const selectedSkillId = skillSelect.value;
    skillSelect.replaceChildren(
      ...skillRegistry.list().map((skill) => {
        const option = document.createElement("option");
        option.value = skill.id;
        option.textContent = skill.custom ? `${skill.name} (Custom)` : skill.name;
        return option;
      })
    );
    if (skillRegistry.get(selectedSkillId)) {
      skillSelect.value = selectedSkillId;
    }
    updateSkillSettingHint();
  }

  function showKnowledgeError(message) {
    knowledgeError.textContent = message;
    knowledgeError.classList.remove("qb-hidden");
  }

  function clearKnowledgeError() {
    knowledgeError.textContent = "";
    knowledgeError.classList.add("qb-hidden");
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
        userSelectedAnswer: "",
        customInstruction: getActiveCustomInstruction(),
        analysisInputMode: getActiveAnalysisInputMode(),
        rect: {
          ...rect,
          devicePixelRatio: window.devicePixelRatio || 1,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        },
        provider: selectedProvider,
        openaiBaseUrl: selectedOpenaiBaseUrl,
        openaiApiKey: selectedOpenaiApiKey,
        openaiModel: selectedOpenaiModel
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

    if (response.ok && response.stage === "ocr") {
      setStatus("OCR complete. Edit the text above if needed, then click Analyze Question.");
      lastScreenshotAvailable =
        lastScreenshotAvailable || Boolean(response.croppedImageDataUrl);
      recropButton.disabled = !lastScreenshotAvailable;
      return;
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
    const sourceText =
      response.ocrText ||
      ocrTextarea.value ||
      response.aiResult?.questionText ||
      "";
    lastAnalysisContext = {
      ocrText: sourceText,
      croppedImageDataUrl: response.croppedImageDataUrl || "",
      inputMode: getActiveAnalysisInputMode(),
      analysisResult: response.aiResult,
      aiResult: response.aiResult,
      numberedLines: numberOcrLines(sourceText),
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
    if (result.formulas) {
      currentFormulas = result.formulas;
    }

    if (result.croppedImageDataUrl) {
      previewImage.src = result.croppedImageDataUrl;
      previewSection.classList.remove("qb-hidden");
    }

    if (result.ocrText) {
      ocrTextarea.value = result.ocrText;
      ocrSection.classList.remove("qb-hidden");
      
      // Reset OCR tab to Edit
      ocrTabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === "edit"));
      ocrPreview.classList.add("qb-hidden");
      ocrTextarea.classList.remove("qb-hidden");
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
      followupStreamingBubble.replaceChildren(renderMarkdown(result.followupText));
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
            : `${getActiveModelLabel()} · ${getSubjectPreset(selectedSubject).label}`
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
        const qTextElement = createElement("div", "qb-question-text");
        if (containsLatexMarkers(result.questionText)) {
          qTextElement.appendChild(renderTextWithFormulas(result.questionText));
        } else {
          qTextElement.textContent = result.questionText;
        }
        container.append(qTextElement);
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
              "AI Provider",
              getActiveModelLabel()
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
      const titleText = `${option.isCorrect ? "Correct" : "Not selected"}: ${
        option.label ? `${option.label}. ` : ""
      }${option.text}`;
      const title = createElement("div", "qb-option-title");
      if (containsLatexMarkers(titleText)) {
        title.appendChild(renderTextWithFormulas(titleText));
      } else {
        title.textContent = titleText;
      }

      const reason = createElement("div", "qb-option-reason");
      if (option.reason && containsLatexMarkers(option.reason)) {
        reason.appendChild(renderTextWithFormulas(option.reason));
      } else {
        reason.textContent = option.reason || "";
      }

      item.append(title, reason);
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
      `qb-result-value ${valueClass}`.trim()
    );
    if (value && containsLatexMarkers(value)) {
      valueElement.appendChild(renderTextWithFormulas(value));
    } else {
      valueElement.textContent = value || "Not provided";
    }
    item.append(labelElement, valueElement);
    return item;
  }

  function resetOutput() {
    clearError();
    clearUserAnswerCheck();
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
    currentFormulas = [];
    previewSection.classList.add("qb-hidden");
    ocrSection.classList.add("qb-hidden");
    
    // Reset OCR tabs to Edit
    ocrTabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === "edit"));
    ocrPreview.classList.add("qb-hidden");
    ocrTextarea.classList.remove("qb-hidden");
    
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
    analyzeButton.textContent = processing
      ? "Analyzing..."
      : (lastAnalysisContext ? "Analyze Again" : "Analyze Question");
    modelSelect.disabled = processing || Boolean(modelRequestId);
    ocrLanguageSelect.disabled =
      processing || getActiveAnalysisInputMode() === "image";
    imageInputCheckbox.disabled = processing || selectedProvider !== "openai";
    subjectSelect.disabled = processing;
    modeButtons.forEach((button) => {
      button.disabled = processing;
    });
    recropButton.disabled = processing || !lastScreenshotAvailable;
    cancelButton.classList.toggle("qb-hidden", !processing);
    cancelButton.disabled = !processing;
    chatSendButton.disabled = processing || !modelReady;
    chatAttachButton.disabled = processing || selectedProvider !== "openai";
    chatClearButton.disabled = processing;
    captureSelectionButton.disabled = processing;
    capturePageButton.disabled = processing;
    runSkillButton.disabled =
      processing || !currentKnowledgeContext?.text?.trim();
    saveArtifactButton.disabled = processing || !currentSkillResult;
  }

  async function ensureModelOnboarding() {
    await loadPreferences();
    
    if (selectedProvider === "openai") {
      modelReady = true;
      cropButton.disabled = false;
      modelCard.classList.add("qb-model-card-ready");
      modelCardTitle.textContent = "OpenAI Compatible API Ready";
      modelCardText.textContent = `Using API model: ${selectedOpenaiModel}`;
      modelProgress.classList.add("qb-hidden");
      modelActions.classList.add("qb-hidden");
      localSettingsGroup.classList.add("qb-hidden");
      openaiSettingsGroup.classList.remove("qb-hidden");
      updateChatProviderState();
      return;
    }

    localSettingsGroup.classList.remove("qb-hidden");
    openaiSettingsGroup.classList.add("qb-hidden");

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
    updateChatProviderState();
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
          ANALYSIS_INPUT_MODE_KEY,
          THEME_KEY,
          CUSTOM_INSTRUCTIONS_KEY,
          PROVIDER_KEY,
          OPENAI_BASE_URL_KEY,
          OPENAI_API_KEY_KEY,
          OPENAI_MODEL_KEY,
          RETENTION_POLICY_KEY,
          ACTIVE_WORKSPACE_KEY,
          PROFILE_KEY,
          SIDEBAR_WIDTH_KEY
        ])
        .then(async (storage) => {
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
          selectedAnalysisInputMode = normalizeAnalysisInputMode(
            storage[ANALYSIS_INPUT_MODE_KEY]
          );
          selectedTheme = normalizeTheme(storage[THEME_KEY]);
          floatingButtonDocked =
            storage[FLOATING_BUTTON_DOCKED_KEY] === true;
          customInstructions = normalizeCustomInstructions(
            storage[CUSTOM_INSTRUCTIONS_KEY]
          );
          
          selectedProvider = storage[PROVIDER_KEY] || "local";
          selectedOpenaiBaseUrl = storage[OPENAI_BASE_URL_KEY] || "https://api.openai.com/v1";
          selectedOpenaiApiKey = storage[OPENAI_API_KEY_KEY] || "";
          selectedOpenaiModel = storage[OPENAI_MODEL_KEY] || "gpt-4o-mini";
          retentionPolicy = ["session", "7-days", "30-days", "forever"].includes(
            storage[RETENTION_POLICY_KEY]
          )
            ? storage[RETENTION_POLICY_KEY]
            : "30-days";
          retentionPolicySelect.value = retentionPolicy;
          workspaceStore =
            retentionPolicy === "session"
              ? new WorkspaceStore({ sessionOnly: true })
              : createPersistentWorkspaceClient();
          if (retentionPolicy !== "session") {
            await workspaceStore.applyRetention(retentionPolicy);
          }
          if (storage[ACTIVE_WORKSPACE_KEY]) {
            currentWorkspace = await workspaceStore.get(
              "workspaces",
              storage[ACTIVE_WORKSPACE_KEY]
            );
          }
          userProfile =
            storage[PROFILE_KEY] && typeof storage[PROFILE_KEY] === "object"
              ? storage[PROFILE_KEY]
              : {};
          sidebarWidth = normalizeSidebarWidth(storage[SIDEBAR_WIDTH_KEY]);
          applySidebarWidth();
          applyKnowledgeProfileToUI();
          customSkills = await workspaceStore.getAll("customSkills");
          rebuildSkillRegistry();
          await renderMemories();
          
          modelSelect.value = selectedModelId;
          ocrLanguageSelect.value = selectedOcrLanguage;
          subjectSelect.value = selectedSubject;
          imageInputCheckbox.checked = selectedAnalysisInputMode === "image";
          
          providerSelect.value = selectedProvider;
          openaiUrlInput.value = selectedOpenaiBaseUrl;
          openaiKeyInput.value = selectedOpenaiApiKey;
          openaiModelInput.value = selectedOpenaiModel;
          
          applyAnalysisMode();
          applyAnalysisInputMode();
          applyTheme();
          applyFloatingButtonDockState();
          customEnabled.checked = customInstructions.enabled;
          loadCustomInstructionEditor();
          applyProvider();
        });
    }

    return preferencesLoadedPromise;
  }

  function applyProvider() {
    const isLocal = selectedProvider === "local";
    localSettingsGroup.classList.toggle("qb-hidden", !isLocal);
    openaiSettingsGroup.classList.toggle("qb-hidden", isLocal);

    const subtitle = sidebar.querySelector(".qb-subtitle");
    if (subtitle) {
      subtitle.textContent = isLocal ? "Local-first Knowledge Copilot" : "API Knowledge Copilot";
    }

    if (isLocal) {
      modelCard.classList.remove("qb-model-card-ready");
      modelReady = false;
      modelStatusChecked = false;
      selectedModelCached = false;
      cropButton.disabled = true;
      ensureModelOnboarding();
    } else {
      modelReady = true;
      cropButton.disabled = false;
      modelCard.classList.add("qb-model-card-ready");
      modelCardTitle.textContent = "OpenAI Compatible API Ready";
      modelCardText.textContent = `Using API model: ${selectedOpenaiModel}`;
      modelProgress.classList.add("qb-hidden");
      modelActions.classList.add("qb-hidden");
      setStatus("Ready to crop a question.");
    }
    applyAnalysisInputMode();
    updateChatProviderState();
  }

  async function onProviderChange() {
    selectedProvider = providerSelect.value;
    await chrome.storage.local.set({
      [PROVIDER_KEY]: selectedProvider
    });
    applyProvider();
  }

  async function onOpenaiSaveSettings() {
    selectedOpenaiBaseUrl = openaiUrlInput.value.trim() || "https://api.openai.com/v1";
    selectedOpenaiApiKey = openaiKeyInput.value.trim();
    selectedOpenaiModel = openaiModelInput.value.trim() || "gpt-4o-mini";

    await chrome.storage.local.set({
      [OPENAI_BASE_URL_KEY]: selectedOpenaiBaseUrl,
      [OPENAI_API_KEY_KEY]: selectedOpenaiApiKey,
      [OPENAI_MODEL_KEY]: selectedOpenaiModel
    });

    if (selectedProvider === "openai") {
      modelCardText.textContent = `Using API model: ${selectedOpenaiModel}`;
    }
    updateChatProviderState();
    setStatus("API settings saved.");
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

  async function onAnalysisInputModeChange() {
    selectedAnalysisInputMode = imageInputCheckbox.checked ? "image" : "ocr";
    applyAnalysisInputMode();
    await chrome.storage.local.set({
      [ANALYSIS_INPUT_MODE_KEY]: selectedAnalysisInputMode
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

  function normalizeAnalysisInputMode(value) {
    return value === "image" ? "image" : "ocr";
  }

  function getActiveAnalysisInputMode() {
    return selectedProvider === "openai" &&
      selectedAnalysisInputMode === "image"
      ? "image"
      : "ocr";
  }

  function getActiveModelLabel() {
    return selectedProvider === "openai"
      ? `API: ${selectedOpenaiModel || "OpenAI Compatible"}`
      : `Local: ${getModelProfile(selectedModelId).label}`;
  }

  function applyAnalysisInputMode() {
    const canUseImageInput = selectedProvider === "openai";
    imageInputCheckbox.checked = getActiveAnalysisInputMode() === "image";
    imageInputCheckbox.disabled =
      !canUseImageInput || Boolean(activeRequestId);
    imageInputNote.textContent = canUseImageInput
      ? "Requires an OpenAI-compatible vision model."
      : "Switch Provider to OpenAI Compatible API to use image input.";
    ocrLanguageSelect.disabled =
      Boolean(activeRequestId) || getActiveAnalysisInputMode() === "image";
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

  function startSidebarResize(event) {
    if (event.button !== 0 || window.innerWidth <= 420) return;
    sidebarResizeState = { pointerId: event.pointerId };
    sidebarResizeHandle.setPointerCapture(event.pointerId);
    sidebar.classList.add("qb-sidebar-resizing");
    event.preventDefault();
  }

  function resizeSidebar(event) {
    if (sidebarResizeState?.pointerId !== event.pointerId) return;
    sidebarWidth = clampSidebarWidth(window.innerWidth - event.clientX);
    applySidebarWidth();
  }

  function finishSidebarResize(event) {
    if (sidebarResizeState?.pointerId !== event.pointerId) return;
    sidebarResizeState = null;
    sidebar.classList.remove("qb-sidebar-resizing");
    if (sidebarResizeHandle.hasPointerCapture(event.pointerId)) {
      sidebarResizeHandle.releasePointerCapture(event.pointerId);
    }
    chrome.storage.local
      .set({ [SIDEBAR_WIDTH_KEY]: sidebarWidth })
      .catch(() => {});
  }

  function resetSidebarWidth() {
    sidebarWidth = 390;
    applySidebarWidth();
    chrome.storage.local
      .set({ [SIDEBAR_WIDTH_KEY]: sidebarWidth })
      .catch(() => {});
  }

  function resizeSidebarWithKeyboard(event) {
    if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") {
      resetSidebarWidth();
      return;
    }
    sidebarWidth = clampSidebarWidth(
      sidebarWidth + (event.key === "ArrowLeft" ? 40 : -40)
    );
    applySidebarWidth();
    chrome.storage.local
      .set({ [SIDEBAR_WIDTH_KEY]: sidebarWidth })
      .catch(() => {});
  }

  function applySidebarWidth() {
    if (window.innerWidth <= 420) {
      sidebar.style.removeProperty("--qb-sidebar-width");
      return;
    }
    sidebarWidth = clampSidebarWidth(sidebarWidth);
    sidebar.style.setProperty("--qb-sidebar-width", `${sidebarWidth}px`);
    sidebarResizeHandle.setAttribute("aria-valuenow", String(sidebarWidth));
    sidebarResizeHandle.setAttribute("aria-valuemin", "360");
    sidebarResizeHandle.setAttribute(
      "aria-valuemax",
      String(Math.floor(window.innerWidth * 0.92))
    );
  }

  function normalizeSidebarWidth(value) {
    const width = Number(value);
    return Number.isFinite(width) ? clampSidebarWidth(width) : 390;
  }

  function clampSidebarWidth(value) {
    return Math.round(
      Math.min(Math.max(Number(value) || 390, 340), window.innerWidth * 0.92)
    );
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
      ? "Expand QuizBuddy Labs button"
      : "Open QuizBuddy Labs";
    floatingButton.setAttribute(
      "aria-label",
      floatingButtonDocked
        ? "Expand QuizBuddy Labs button"
        : "Open QuizBuddy Labs"
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
        customInstruction: getActiveCustomInstruction(),
        formulas: currentFormulas,
        hasFormulas: currentFormulas.length > 0,
        provider: selectedProvider,
        openaiBaseUrl: selectedOpenaiBaseUrl,
        openaiApiKey: selectedOpenaiApiKey,
        openaiModel: selectedOpenaiModel
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
    if (activeKnowledgeSkillId) {
      recordLocalMetric({
        name: "task_cancelled",
        skillId: activeKnowledgeSkillId,
        provider: selectedProvider,
        success: false
      });
      activeKnowledgeSkillId = "";
    }
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
    if (chatStreamingBubble) {
      chatStreamingBubble.classList.remove("qb-chat-message-pending");
      chatStreamingBubble.textContent = "Response cancelled.";
      chatStreamingBubble = null;
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
        customInstruction: getActiveCustomInstruction(),
        provider: selectedProvider,
        openaiBaseUrl: selectedOpenaiBaseUrl,
        openaiApiKey: selectedOpenaiApiKey,
        openaiModel: selectedOpenaiModel
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
      reply.replaceChildren(renderMarkdown(response.reply));
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

  async function sendChatMessage() {
    const text = chatInput.value.trim();
    if ((!text && !pendingChatImage) || activeRequestId) {
      return;
    }
    if (!modelReady) {
      showChatError(
        selectedProvider === "local"
          ? "Prepare the selected local model before chatting."
          : "Configure the API provider before chatting."
      );
      return;
    }
    if (pendingChatImage && selectedProvider !== "openai") {
      showChatError(
        "Image attachments require the OpenAI Compatible API provider."
      );
      return;
    }

    clearChatError();
    cancelScheduledResourceRelease();
    const userEntry = {
      role: "user",
      text,
      imageDataUrl: pendingChatImage?.dataUrl || "",
      imageName: pendingChatImage?.name || ""
    };
    chatHistory.push(userEntry);
    chatHistory = chatHistory.slice(-20);
    appendChatMessage(userEntry);
    chatInput.value = "";
    resizeChatInput();
    clearPendingChatImage();

    chatStreamingBubble = createElement(
      "div",
      "qb-chat-message qb-chat-message-assistant qb-chat-message-pending",
      "Thinking"
    );
    chatMessages.append(chatStreamingBubble);
    scrollChatToBottom();

    activeRequestId = crypto.randomUUID();
    const taskId = activeRequestId;
    setProcessingState(true);

    try {
      const response = await chrome.runtime.sendMessage({
        type: "QB_CHAT_LOCAL",
        requestId: taskId,
        taskId,
        modelId: selectedModelId,
        messages: chatHistory.map(({ role, text: messageText, imageDataUrl }) => ({
          role,
          text: messageText,
          imageDataUrl
        })),
        provider: selectedProvider,
        openaiBaseUrl: selectedOpenaiBaseUrl,
        openaiApiKey: selectedOpenaiApiKey,
        openaiModel: selectedOpenaiModel
      });
      if (activeRequestId !== taskId) return;
      if (!response?.ok) {
        if (response?.cancelled) {
          throw new Error("Chat task was cancelled.");
        }
        throw new Error(response?.error || "Could not complete the chat response.");
      }

      const reply = String(response.reply || "").trim();
      renderStreamingChatText(reply);
      chatStreamingBubble?.classList.remove("qb-chat-message-pending");
      chatHistory.push({ role: "assistant", text: reply, imageDataUrl: "" });
      chatHistory = chatHistory.slice(-20);
    } catch (error) {
      if (chatStreamingBubble) {
        chatStreamingBubble.classList.remove("qb-chat-message-pending");
        chatStreamingBubble.textContent = "Could not complete this response.";
      }
      showChatError(error.message);
    } finally {
      chatStreamingBubble = null;
      if (activeRequestId === taskId) {
        activeRequestId = null;
        setProcessingState(false);
        scheduleResourceRelease();
      }
    }
  }

  function appendChatMessage({ role, text, imageDataUrl, imageName }) {
    chatMessages.querySelector(".qb-chat-empty")?.remove();
    const bubble = createElement(
      "div",
      `qb-chat-message ${
        role === "assistant"
          ? "qb-chat-message-assistant"
          : "qb-chat-message-user"
      }`
    );
    if (imageDataUrl) {
      const image = document.createElement("img");
      image.className = "qb-chat-message-image";
      image.src = imageDataUrl;
      image.alt = imageName || "Attached image";
      bubble.append(image);
    }
    if (text) {
      const textElement = createElement("div", "qb-chat-message-text");
      if (role === "assistant") {
        textElement.append(renderMarkdown(text));
      } else {
        textElement.textContent = text;
      }
      bubble.append(textElement);
    }
    chatMessages.append(bubble);
    scrollChatToBottom();
    return bubble;
  }

  function renderStreamingChatText(text) {
    if (!chatStreamingBubble) {
      return;
    }
    chatStreamingBubble.classList.remove("qb-chat-message-pending");
    chatStreamingBubble.replaceChildren(renderMarkdown(text));
    scrollChatToBottom();
  }

  function renderMarkdown(markdown) {
    const fragment = document.createDocumentFragment();
    const container = createElement("div", "qb-markdown");
    for (const block of parseMarkdownBlocks(markdown)) {
      container.append(renderMarkdownBlock(block));
    }
    fragment.append(container);
    return fragment;
  }

  function renderMarkdownBlock(block) {
    if (block.type === "heading") {
      const heading = document.createElement(`h${block.level}`);
      appendMarkdownInline(heading, block.text);
      return heading;
    }
    if (block.type === "code") {
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = block.text;
      if (block.language) code.dataset.language = block.language;
      pre.append(code);
      return pre;
    }
    if (block.type === "rule") {
      return document.createElement("hr");
    }
    if (block.type === "quote") {
      const quote = document.createElement("blockquote");
      for (const child of block.children) {
        quote.append(renderMarkdownBlock(child));
      }
      return quote;
    }
    if (block.type === "list") {
      const list = document.createElement(block.ordered ? "ol" : "ul");
      for (const itemText of block.items) {
        const item = document.createElement("li");
        appendMarkdownInline(item, itemText);
        list.append(item);
      }
      return list;
    }
    if (block.type === "table") {
      const wrapper = createElement("div", "qb-markdown-table-wrap");
      const table = document.createElement("table");
      const head = document.createElement("thead");
      const headRow = document.createElement("tr");
      for (const headerText of block.headers) {
        const header = document.createElement("th");
        appendMarkdownInline(header, headerText);
        headRow.append(header);
      }
      head.append(headRow);
      const body = document.createElement("tbody");
      for (const row of block.rows) {
        const tableRow = document.createElement("tr");
        for (let index = 0; index < block.headers.length; index += 1) {
          const cell = document.createElement("td");
          appendMarkdownInline(cell, row[index] || "");
          tableRow.append(cell);
        }
        body.append(tableRow);
      }
      table.append(head, body);
      wrapper.append(table);
      return wrapper;
    }
    const paragraph = document.createElement("p");
    appendMarkdownInline(paragraph, block.text);
    return paragraph;
  }

  function appendMarkdownInline(parent, text) {
    for (const token of parseMarkdownInline(text)) {
      if (token.type === "text") {
        appendTextWithBreaksAndFormulas(parent, token.text);
        continue;
      }
      const element = document.createElement(
        token.type === "strong"
          ? "strong"
          : token.type === "emphasis"
            ? "em"
            : token.type === "code"
              ? "code"
              : token.href
                ? "a"
                : "span"
      );
      if (token.type === "link" && token.href) {
        element.href = token.href;
        element.target = "_blank";
        element.rel = "noopener noreferrer";
      }
      if (token.type === "code") {
        element.textContent = token.text;
      } else {
        appendTextWithBreaksAndFormulas(element, token.text);
      }
      parent.append(element);
    }
  }

  function appendTextWithBreaksAndFormulas(parent, text) {
    const lines = String(text).split("\n");
    lines.forEach((line, index) => {
      if (containsLatexMarkers(line)) {
        parent.append(renderTextWithFormulas(line));
      } else {
        parent.append(document.createTextNode(line));
      }
      if (index < lines.length - 1) parent.append(document.createElement("br"));
    });
  }

  async function onChatFileSelected() {
    const [file] = chatFileInput.files || [];
    chatFileInput.value = "";
    if (!file) return;
    await attachChatImage(file);
  }

  async function onChatPaste(event) {
    const imageItem = [...(event.clipboardData?.items || [])].find((item) =>
      item.type.startsWith("image/")
    );
    if (!imageItem) {
      return;
    }
    event.preventDefault();
    const file = imageItem.getAsFile();
    if (file) {
      await attachChatImage(file, "Pasted image");
    }
  }

  async function attachChatImage(file, fallbackName = "") {
    if (selectedProvider !== "openai") {
      showChatError(
        "Switch to OpenAI Compatible API before attaching an image."
      );
      return;
    }
    if (!/^image\/(?:png|jpeg|webp)$/i.test(file.type)) {
      showChatError("Use a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showChatError("The selected image is larger than 10 MB.");
      return;
    }

    try {
      const dataUrl = await resizeChatImage(file);
      const imageName = file.name || fallbackName || "Attached image";
      pendingChatImage = { dataUrl, name: imageName };
      chatAttachmentImage.src = dataUrl;
      chatAttachmentName.textContent = imageName;
      chatAttachment.classList.remove("qb-hidden");
      clearChatError();
      chatInput.focus();
    } catch (error) {
      showChatError(`Could not attach image: ${error.message}`);
    }
  }

  async function resizeChatImage(file) {
    const sourceUrl = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const candidate = new Image();
        candidate.onload = () => resolve(candidate);
        candidate.onerror = () => reject(new Error("The image could not be read."));
        candidate.src = sourceUrl;
      });
      const maxDimension = 1600;
      const scale = Math.min(
        1,
        maxDimension / Math.max(image.naturalWidth, image.naturalHeight)
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Canvas is unavailable.");
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.86);
    } finally {
      URL.revokeObjectURL(sourceUrl);
    }
  }

  function clearPendingChatImage() {
    pendingChatImage = null;
    chatAttachmentImage.removeAttribute("src");
    chatAttachmentName.textContent = "";
    chatAttachment.classList.add("qb-hidden");
  }

  function clearChat() {
    if (activeRequestId) return;
    chatHistory = [];
    chatStreamingBubble = null;
    clearPendingChatImage();
    clearChatError();
    chatMessages.replaceChildren(createChatEmptyState());
    chatInput.value = "";
    resizeChatInput();
    chatInput.focus();
  }

  function createChatEmptyState() {
    const empty = createElement("div", "qb-chat-empty");
    empty.append(
      createElement("div", "qb-chat-empty-title", "How can I help?"),
      createElement(
        "div",
        "qb-chat-empty-text",
        "Ask a question or attach an image for the API vision model."
      )
    );
    return empty;
  }

  function resizeChatInput() {
    chatInput.style.height = "auto";
    chatInput.style.height = `${Math.min(chatInput.scrollHeight, 140)}px`;
  }

  function scrollChatToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function showChatError(message) {
    chatError.textContent = message;
    chatError.classList.remove("qb-hidden");
  }

  function clearChatError() {
    chatError.textContent = "";
    chatError.classList.add("qb-hidden");
  }

  function updateChatProviderState() {
    const supportsImages = selectedProvider === "openai";
    chatModelLabel.textContent = getActiveModelLabel();
    chatAttachButton.disabled = !supportsImages || Boolean(activeRequestId);
    chatAttachButton.title = supportsImages
      ? "+"
      : "Image attachments require the API provider";
    chatSendButton.disabled = Boolean(activeRequestId) || !modelReady;
    if (!supportsImages && pendingChatImage) {
      clearPendingChatImage();
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
        aiResult: selectedQuestion,
        provider: selectedProvider,
        openaiBaseUrl: selectedOpenaiBaseUrl,
        openaiApiKey: selectedOpenaiApiKey,
        openaiModel: selectedOpenaiModel
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
      const scaleX = image.naturalWidth / bounds.width;
      const scaleY = image.naturalHeight / bounds.height;
      closeModal();
      await processRecrop({
        x: rect.x * scaleX,
        y: rect.y * scaleY,
        width: rect.width * scaleX,
        height: rect.height * scaleY,
        coordinateSpace: "image-pixels"
      });
    });
  }

  async function processRecrop(rect) {
    activeRequestId = crypto.randomUUID();
    const taskId = activeRequestId;
    cancelScheduledResourceRelease();
    resetOutput();
    setProcessingState(true);
    setStatus("Processing the new crop...", true);

    try {
      const response = await chrome.runtime.sendMessage({
        type: "QB_RECROP_LAST_SCREENSHOT",
        requestId: taskId,
        taskId,
        modelId: selectedModelId,
        ocrLanguage: selectedOcrLanguage,
        mode: selectedAnalysisMode,
        subject: selectedSubject,
        userSelectedAnswer: "",
        customInstruction: getActiveCustomInstruction(),
        analysisInputMode: getActiveAnalysisInputMode(),
        rect,
        provider: selectedProvider,
        openaiBaseUrl: selectedOpenaiBaseUrl,
        openaiApiKey: selectedOpenaiApiKey,
        openaiModel: selectedOpenaiModel
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

  function clearUserAnswerCheck() {
    checkAnswerCheckbox.checked = false;
    userAnswerInput.value = "";
    userAnswerInput.classList.add("qb-hidden");
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
