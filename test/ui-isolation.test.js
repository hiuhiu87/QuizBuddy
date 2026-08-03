import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("content UI is isolated in a closed Shadow Root", async () => {
  const source = await readFile("content/content.js", "utf8");

  assert.match(source, /attachShadow\(\{\s*mode:\s*"closed"\s*\}\)/);
  assert.match(source, /shadowRoot\.append\(floatingButton,\s*sidebar\)/);
  assert.match(source, /shadowRoot\.append\(cropOverlay\)/);
  assert.match(source, /element\.style\.setProperty\(property,\s*value,\s*"important"\)/);
});

test("content host exposes no public DOM id or named window flag", async () => {
  const source = await readFile("content/content.js", "utf8");

  assert.doesNotMatch(source, /host\.id\s*=/);
  assert.doesNotMatch(source, /quizbuddy-ai-root/);
  assert.doesNotMatch(source, /window\.__quizBuddyInjected/);
  assert.match(source, /Symbol\.for\("qb\.content\.injected"\)/);
  assert.match(source, /enumerable:\s*false/);
});

test("content CSS resets the shadow host", async () => {
  const source = await readFile("content/content.js", "utf8");
  const css = await readFile("content/content.css", "utf8");

  assert.match(css, /:host\s*\{[\s\S]*all:\s*initial;/);
  assert.match(css, /:host \*,[\s\S]*box-sizing:\s*border-box;/);
  assert.doesNotMatch(css, /@import/);
  assert.match(source, /import designTokenStyles from "\.\/styles\/tokens\.css"/);
  assert.match(source, /import primitiveStyles from "\.\/styles\/primitives\.css"/);
  assert.match(
    source,
    /\[\s*designTokenStyles,\s*primitiveStyles,\s*extensionStyles,\s*katexStyles\s*\]\.join/
  );
});

test("content UI supports a persisted system-aware dark theme", async () => {
  const source = await readFile("content/content.js", "utf8");
  const css = await readFile("content/content.css", "utf8");

  assert.match(source, /const THEME_KEY = "qbTheme"/);
  assert.match(source, /prefers-color-scheme: dark/);
  assert.match(source, /\[THEME_KEY\]: selectedTheme/);
  assert.match(source, /host\.dataset\.qbTheme = theme/);
  assert.match(source, /qb-theme-button/);
  assert.match(css, /:host\(\[data-qb-theme="dark"\]\)/);
  assert.match(css, /color-scheme:\s*dark/);
  assert.match(css, /data-qb-theme="dark"\]\) \.qb-floating-button/);
  assert.match(css, /data-qb-theme="dark"\]\) \.qb-sidebar-body/);
  assert.match(css, /qb-sidebar-body::\-webkit-scrollbar-thumb/);
  assert.match(css, /data-qb-theme="dark"\]\) \.qb-model-delete-button/);
  assert.match(css, /data-qb-theme="dark"\]\) \.qb-model-download-button/);
  assert.match(css, /data-qb-theme="dark"\]\) \.qb-select option/);
  assert.match(css, /data-qb-theme="dark"\]\) input::placeholder/);
  assert.match(css, /data-qb-theme="dark"\]\) input\[type="checkbox"\]/);
});

test("manifest does not inject CSS into the webpage document", async () => {
  const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
  const contentScript = manifest.content_scripts[0];

  assert.equal(contentScript.css, undefined);
  assert.equal(manifest.web_accessible_resources, undefined);
});

test("floating and toolbar buttons use packaged icons", async () => {
  const source = await readFile("content/content.js", "utf8");
  const manifest = JSON.parse(await readFile("manifest.json", "utf8"));

  assert.match(source, /import floatingIconUrl from "\.\.\/assets\/icon\.png"/);
  assert.doesNotMatch(source, /chrome\.runtime\.getURL\("icon\.png"\)/);
  assert.equal(manifest.action.default_icon["16"], "assets/icon-16.png");
  assert.equal(manifest.action.default_icon["32"], "assets/icon-32.png");
  assert.equal(manifest.icons["128"], "assets/icon-128.png");
});

test("floating button can dock to the edge and expand again", async () => {
  const source = await readFile("content/content.js", "utf8");
  const css = await readFile("content/content.css", "utf8");

  assert.match(source, /qbFloatingButtonDocked/);
  assert.match(source, /FLOATING_BUTTON_DOCKED_KEY/);
  assert.match(source, /classList\.toggle\("qb-floating-docked"/);
  assert.match(source, /if \(floatingButtonDocked\)/);
  assert.match(source, /pointerdown/);
  assert.match(source, /setPointerCapture/);
  assert.match(source, /deltaX >= 24 \|\| nearRightEdge/);
  assert.match(source, /suppressFloatingClick = floatingButtonDragged/);
  assert.doesNotMatch(source, /qb-floating-dock-toggle/);
  assert.match(css, /\.qb-floating-button\.qb-floating-docked/);
  assert.match(css, /\.qb-floating-button\.qb-floating-dragging/);
  assert.match(css, /\.qb-floating-dock-handle/);
});

test("manifest exposes the crop keyboard shortcut", async () => {
  const manifest = JSON.parse(await readFile("manifest.json", "utf8"));

  assert.equal(
    manifest.commands["start-crop"].suggested_key.default,
    "Alt+Shift+Q"
  );
});

test("model download requires an explicit user click", async () => {
  const source = await readFile("content/content.js", "utf8");

  assert.doesNotMatch(source, /prepareLocalModel\(true\)/);
  assert.match(source, /Nothing is downloaded until you click the button below/);
  assert.match(source, /chrome-extension:\/\/\$\{chrome\.runtime\.id\}/);
});

test("user answer check is scoped to analyze-again, not new OCR crops", async () => {
  const source = await readFile("content/content.js", "utf8");
  const captureBlock = source.match(
    /type:\s*"QB_CAPTURE_PROCESS_LOCAL"[\s\S]*?rect:\s*\{/
  )?.[0] || "";
  const recropBlock = source.match(
    /type:\s*"QB_RECROP_LAST_SCREENSHOT"[\s\S]*?rect/
  )?.[0] || "";
  const analyzeBlock = source.match(
    /type:\s*"QB_ANALYZE_TEXT_LOCAL"[\s\S]*?hasFormulas/
  )?.[0] || "";

  assert.match(captureBlock, /userSelectedAnswer:\s*""/);
  assert.match(recropBlock, /userSelectedAnswer:\s*""/);
  assert.match(analyzeBlock, /userSelectedAnswer:\s*getUserSelectedAnswer\(\)/);
  assert.match(source, /function clearUserAnswerCheck\(\)/);
  assert.match(source, /clearUserAnswerCheck\(\);/);
});

test("direct image input is API-only and falls back to OCR for local provider", async () => {
  const content = await readFile("content/content.js", "utf8");
  const background = await readFile("background.js", "utf8");
  const offscreen = await readFile("offscreen.js", "utf8");

  assert.match(content, /qb-image-input-checkbox/);
  assert.match(content, /selectedProvider === "openai" &&[\s\S]*selectedAnalysisInputMode === "image"/);
  assert.match(content, /imageInputCheckbox\.disabled =[\s\S]*selectedProvider !== "openai"/);
  assert.match(content, /analysisInputMode: getActiveAnalysisInputMode\(\)/);
  assert.match(background, /analysisInputMode: message\.analysisInputMode/);
  assert.match(offscreen, /analysisInputMode === "image"/);
  assert.match(offscreen, /provider !== "openai"/);
  assert.match(offscreen, /runOpenAIImageAnalysis/);
  assert.match(offscreen, /If exactly one question is visible, return exactly one/);
  assert.match(offscreen, /trustModelSelections: true/);
});

test("sidebar exposes Capture, Quiz, Chat, and Library workspaces", async () => {
  const content = await readFile("content/content.js", "utf8");
  const background = await readFile("background.js", "utf8");
  const offscreen = await readFile("offscreen.js", "utf8");

  assert.match(content, /data-workspace-tab="capture"[\s\S]*Capture/);
  assert.match(content, /data-workspace-tab="quick"[\s\S]*Quiz/);
  assert.match(content, /data-workspace-tab="chat"[\s\S]*Chat/);
  assert.match(content, /data-workspace-tab="library"[\s\S]*Library/);
  assert.match(content, /type:\s*"QB_RUN_SKILL"/);
  assert.match(content, /type:\s*"QB_WORKSPACE_OP"/);
  assert.match(content, /qb-capture-selection/);
  assert.match(content, /qb-capture-page/);
  assert.match(content, /qb-capture-last-crop/);
  assert.match(content, /qb-retention-policy/);
  assert.match(content, /Accept Draft/);
  assert.match(content, /No website action was executed/);
  assert.match(content, /qb-sidebar-resize-handle/);
  assert.match(content, /SIDEBAR_WIDTH_KEY = "qbSidebarWidth"/);
  assert.match(content, /function resizeSidebarWithKeyboard/);
  assert.match(content, /replaceChildren\(renderMarkdown\(text\)\)/);
  assert.match(content, /parseMarkdownBlocks/);
  assert.match(content, /class="qb-chat-file-input"[\s\S]*accept="image\/png,image\/jpeg,image\/webp"/);
  assert.match(content, /chatInput\.addEventListener\("paste", onChatPaste\)/);
  assert.match(content, /clipboardData\?\.items/);
  assert.match(content, /attachChatImage\(file, "Pasted image"\)/);
  assert.match(content, /type:\s*"QB_CHAT_LOCAL"/);
  assert.match(content, /pendingChatImage && selectedProvider !== "openai"/);
  assert.match(background, /QB_OFFSCREEN_CHAT/);
  assert.match(background, /QB_OFFSCREEN_WORKSPACE_OP/);
  assert.match(offscreen, /function normalizeChatMessages/);
  assert.match(offscreen, /extensionWorkspaceStore/);
  assert.match(offscreen, /Image attachments require the OpenAI Compatible API provider/);
  assert.match(offscreen, /partialField = "chatText"/);
  assert.match(offscreen, /runKnowledgeSkill/);
});

test("content releases local resources after use and when the page closes", async () => {
  const source = await readFile("content/content.js", "utf8");

  assert.match(source, /window\.addEventListener\("pagehide", releaseLocalResources\)/);
  assert.match(source, /scheduleResourceRelease\(\)/);
  assert.match(source, /type:\s*"QB_RELEASE_RESOURCES"/);
});

test("offscreen resources do not accumulate across language changes", async () => {
  const source = await readFile("offscreen.js", "utf8");

  assert.match(source, /await worker\.terminate\(\)/);
  assert.match(source, /await engine\.unload\(\)/);
  assert.doesNotMatch(source, /ocrWorkerPromises\s*=\s*new Map/);
});

test("local inference uses accuracy-oriented decoding and context", async () => {
  const source = await readFile("offscreen.js", "utf8");

  assert.match(source, /role:\s*"system"/);
  assert.match(source, /temperature:\s*0/);
  assert.match(source, /estimateQuestionCount\(ocrText\)/);
  assert.match(source, /estimatedQuestionCount >= 2/);
  assert.match(source, /const ANALYSIS_TIMEOUT_MS = 60000/);
  assert.match(source, /const ANALYSIS_TOTAL_TIMEOUT_MS = 210000/);
  assert.match(source, /const LONG_BATCH_CHUNK_SIZE = 1/);
  assert.match(source, /chunkQuestionScopes\(scopes, chunkSize\)/);
  assert.match(source, /max_tokens:\s*maxTokens/);
  assert.match(source, /context_window_size:\s*4096/);
  assert.match(source, /question-only direct-answer prompts/);
});

test("study notes and screenshots remain session-only", async () => {
  const content = await readFile("content/content.js", "utf8");
  const offscreen = await readFile("offscreen.js", "utf8");

  assert.match(content, /let sessionStudyNotes = \[\]/);
  assert.doesNotMatch(content, /qbSessionStudyNotes/);
  assert.doesNotMatch(content, /qbLastScreenshot/);
  assert.match(offscreen, /let lastScreenshotDataUrl = null/);
  assert.match(offscreen, /lastScreenshotDataUrl = null;\n  await releaseComputeResources/);
  assert.doesNotMatch(offscreen, /chrome\.storage/);
});

test("mode and subject preferences are stored without persisting study data", async () => {
  const source = await readFile("content/content.js", "utf8");

  assert.match(source, /const ANALYSIS_MODE_KEY = "qbAnalysisMode"/);
  assert.match(source, /const SUBJECT_PRESET_KEY = "qbSubjectPreset"/);
  assert.match(source, /\[ANALYSIS_MODE_KEY\]: selectedAnalysisMode/);
  assert.match(source, /\[SUBJECT_PRESET_KEY\]: selectedSubject/);
  assert.match(source, /if \(result\.miniExample\)/);
});

test("true re-crop uses the existing offscreen screenshot", async () => {
  const content = await readFile("content/content.js", "utf8");
  const background = await readFile("background.js", "utf8");
  const offscreen = await readFile("offscreen.js", "utf8");

  assert.match(content, /image\.naturalWidth\s*\/\s*bounds\.width/);
  assert.match(content, /coordinateSpace:\s*"image-pixels"/);
  assert.match(background, /QB_RECROP_LAST_SCREENSHOT/);
  assert.match(background, /QB_OFFSCREEN_RECROP_LAST_SCREENSHOT/);
  assert.match(offscreen, /screenshotDataUrl: lastScreenshotDataUrl/);
  assert.match(offscreen, /No screenshot is available/);
});

test("new learning controls stay local and task-scoped", async () => {
  const content = await readFile(
    new URL("../content/content.js", import.meta.url),
    "utf8"
  );
  const background = await readFile(
    new URL("../background.js", import.meta.url),
    "utf8"
  );
  const offscreen = await readFile(
    new URL("../offscreen.js", import.meta.url),
    "utf8"
  );

  assert.match(content, /Custom Instructions/);
  assert.match(content, /Ask Follow-up/);
  assert.match(content, /QB_CANCEL_TASK/);
  assert.match(content, /Cancel it and start a new crop/);
  assert.match(content, /activeRequestId !== taskId/);
  assert.match(content, /message\.taskId \|\| message\.requestId/);
  assert.match(background, /QB_OFFSCREEN_CANCEL_TASK/);
  assert.match(background, /taskId: requestId/);
  assert.match(background, /customInstruction: message\.customInstruction/);
  assert.match(background, /analyzeAnyway: message\.analyzeAnyway/);
  assert.match(offscreen, /detectQuestionQuality/);
  assert.match(offscreen, /buildFollowUpPrompt/);
  assert.match(offscreen, /stream:\s*true/);
  assert.match(offscreen, /max_tokens:\s*320/);
  assert.match(offscreen, /getNoThinkingExtraBody/);
  assert.match(
    offscreen,
    /const stream = await engine\.chat\.completions\.create\(\{[\s\S]*?stream:\s*true/
  );
  assert.match(
    offscreen,
    /consumeFollowUpStream\(stream,\s*engine,\s*id\)/
  );
  assert.match(offscreen, /followupText/);
  assert.match(content, /qb-followup-pending/);
  assert.match(content, /followupStreamingBubble/);
  assert.match(content, /questions detected/);
  assert.match(content, /questions analyzed/);
  assert.match(offscreen, /batchIncomplete/);
  assert.match(offscreen, /recoverQuestionsByScope/);
  assert.match(offscreen, /Recovering question/);
  assert.match(offscreen, /partialAIResult/);
  assert.match(content, /result\.partialAIResult/);
  assert.match(content, /createQuestionResult/);
  assert.doesNotMatch(content, /qbFollowupHistory|followupChatHistory/);
});
