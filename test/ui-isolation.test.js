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
  const css = await readFile("content/content.css", "utf8");

  assert.match(css, /:host\s*\{[\s\S]*all:\s*initial;/);
  assert.match(css, /:host \*,[\s\S]*box-sizing:\s*border-box;/);
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
  assert.match(source, /max_tokens:\s*sourceQuality\.mode === "quick" \? 350 : 950/);
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
  const background = await readFile("background.js", "utf8");
  const offscreen = await readFile("offscreen.js", "utf8");

  assert.match(background, /QB_RECROP_LAST_SCREENSHOT/);
  assert.match(background, /QB_OFFSCREEN_RECROP_LAST_SCREENSHOT/);
  assert.match(offscreen, /screenshotDataUrl: lastScreenshotDataUrl/);
  assert.match(offscreen, /No screenshot is available/);
});
