# QuizBuddy AI

Privacy-first Chrome extension for answering cropped questions with local OCR
and browser-based WebLLM inference.

QuizBuddy AI captures a user-selected region of the visible tab, extracts
Vietnamese or English text with Tesseract.js, and uses a selected local Qwen2.5 model to
produce an answer and learning explanation. It uses no backend, API key, or
external AI inference API.

## Status

QuizBuddy AI is an MVP under active development. The core crop, OCR, local
model setup, and result-rendering flows are implemented.

## Highlights

- Chrome Extension Manifest V3
- Vanilla JavaScript, HTML, and CSS
- Crop-first visible-tab screenshot workflow
- Browser-local Vietnamese and English OCR
- Selectable OCR language and editable OCR text
- Quick Answer and Learning modes
- Subject-aware prompts for English, German, Math, general knowledge, and law
- Optional Check My Answer feedback
- OCR, AI, and overall reliability indicators with visible reasons
- Per-option analysis and compact learning examples
- Local similar-practice generation with answer reveal
- Session-only concept notes
- True re-crop from the last in-memory screenshot
- Private WebGPU and model-fit diagnostics
- Browser-local WebLLM inference through WebGPU
- Explicit consent before downloading model weights
- Fast 0.5B, Balanced 1.5B, and Accurate 3B local model profiles
- Model cache status, retry, switching, and deletion controls
- `Alt+Shift+Q` crop shortcut
- Full answer text instead of invented A/B/C/D labels
- Closed Shadow DOM UI isolation
- No backend, account, API key, analytics, or history

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- Chrome or Edge 116 or newer
- WebGPU and browser hardware acceleration
- Approximately 945 MB to 2.5 GB of available GPU memory, depending on model

## Quick Start

```bash
npm ci
npm run check
npm run build
```

Load the generated extension:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `dist/` directory.

The repository root is source code. Always load `dist/` in Chrome.

## Usage

1. Open a regular `http://` or `https://` page containing a question.
2. Click the QuizBuddy AI toolbar icon or floating icon.
3. Select the Fast or Balanced local model.
4. Review the local model notice and click the download button yourself.
5. Wait for model setup to complete.
6. Click **Crop Question**.
7. Drag over the question. Include answer choices when they exist, but
   question-only crops are also supported.
8. Correct the OCR text if needed and click **Analyze Again**.
9. Review the suggested answer and explanation.

Use **Quick Answer** for a compact result or **Learning Mode** for option
analysis, core knowledge, study notes, and practice generation. Select a
subject preset when specialized guidance is useful. Enable **Check my answer**
and enter a label or free-text answer before cropping or analyzing again to
receive learning-oriented feedback.

After a capture, **Re-crop screenshot** opens the same full screenshot in a
temporary modal. It does not call `captureVisibleTab` again. The screenshot is
kept only in offscreen memory and is cleared when the sidebar session closes.

Press `Alt+Shift+Q` to start cropping and `Escape` to cancel crop mode. Chrome
allows changing the shortcut at `chrome://extensions/shortcuts`.

Drag the floating icon toward the right edge to collapse it into a small edge
handle. Click the handle to expand the icon, then click the icon to open
QuizBuddy AI. A normal click still opens the sidebar, while a completed drag
does not trigger it accidentally. The docked state is saved in Chrome storage.

## Model Download

Executable extension code, OCR workers, OCR WebAssembly, Vietnamese and English
language data, and the compatible WebLLM runtime are bundled into `dist/`.
During a source build, the official runtime artifact is downloaded when absent
and verified against a pinned SHA-256 checksum.

The Fast profile uses Qwen2.5 0.5B with lower memory use. Balanced uses
Qwen2.5 1.5B for moderate reasoning on constrained devices. The recommended
Accurate profile uses Qwen2.5 3B and about 2.5 GB of GPU memory for materially
stronger reasoning. QuizBuddy AI never starts a
model download automatically. The user must select a model and click its
download button. Selected model weights are then downloaded from the official
MLC model repository and cached by WebLLM in Chrome Cache Storage for the
extension origin. Inference runs locally after setup. The model manager shows
cache state and can remove the selected model's cached weights.

The model cache belongs to the extension origin:

```text
chrome-extension://<EXTENSION_ID>
```

This is not the operating system's `Downloads` folder and is not the
`vendor/webllm` source directory. Chrome chooses the physical profile/cache
files and does not expose a stable user-facing filesystem path. Removing the
extension or clearing its site data may remove the cached model.

## Architecture

```text
Content Script
  - Closed Shadow DOM widget and sidebar
  - Crop selection overlay
  - OCR language, editable text, and model controls
  - Mode, subject, answer-check, reliability, practice, and notes UI
  - In-memory re-crop modal and result rendering

Background Service Worker
  - Visible-tab screenshot capture
  - Offscreen document lifecycle
  - Request and progress routing

Offscreen Document
  - Canvas crop and OCR preprocessing
  - Selectable Vietnamese/English Tesseract.js OCR
  - Multi-model WebLLM setup, cache management, and inference
  - AI JSON validation, reliability scoring, and practice generation
  - Temporary full-screenshot memory and device diagnostics
```

## Privacy

QuizBuddy AI does not:

- Send question screenshots or OCR text to Gemini, OpenAI, or another AI API
- Require an API key
- Operate a backend
- Store question history
- Persist screenshots, practice questions, or session study notes
- Require login
- Include analytics or tracking

The first model setup downloads model artifacts from the official MLC
repository. This is a model download, not remote inference.

## UI Isolation

The extension renders its widget, sidebar, setup flow, and crop overlay inside
a closed Shadow Root. CSS is bundled into the content script and mounted inside
that Shadow Root.

Website resets, framework styles, inherited fonts, and global selectors cannot
normally override the extension UI. The light DOM contains only a protected
anonymous host element with no public ID or extension-named attribute and with
critical inline `!important` layout declarations. The reinjection guard lives
in the Chrome content script's isolated JavaScript world rather than a named
page-global property.

This reduces accidental conflicts and simple DOM fingerprinting, but no
extension that displays an overlay inside a webpage can guarantee that it is
undetectable. A page can observe generic DOM insertion, user input, layout,
focus, or resource pressure. QuizBuddy AI does not attempt to bypass proctoring,
anti-cheat systems, access controls, or website policy enforcement.

## Resource Lifecycle

WebLLM and OCR are intentionally loaded in the offscreen document, not in the
webpage content script. To reduce impact on the active page:

- Only one Tesseract worker is kept at a time, even when OCR language changes.
- Closing the sidebar releases WebLLM GPU memory and terminates the OCR worker.
- Compute resources are also released shortly after a completed OCR/AI task.
- The offscreen document can remain briefly for re-crop, but the model and OCR
  worker are unloaded; closing the sidebar clears the temporary screenshot.
- A temporary offscreen document used only for cache inspection is closed
  immediately after the check.

Local processing can still temporarily use substantial CPU, RAM, and GPU while
OCR or inference is actively running.

## Answer Accuracy

For the best available local accuracy:

- Use **Accurate (Recommended)** for the strongest available local reasoning.
- Treat **Balanced** as a memory-conscious compromise, not a high-accuracy model.
- Select the question's specific OCR language when it is known.
- Include the complete question. Include every answer choice when the source
  is multiple-choice.
- Correct OCR mistakes and use **Analyze Again** before trusting a low-confidence result.

Inference uses deterministic decoding, a 4096-token context window, and an
accuracy prompt that requires independent solving and comparison against every
visible choice. If no choices are visible, it switches to direct-answer
behavior and returns the answer content with no option label. The extension
still cannot guarantee a correct answer.

## OCR

Tesseract.js loads bundled Vietnamese and English language data. Users can
choose Vietnamese, English, or combined recognition. `Auto` currently uses the
combined `vie+eng` worker, which is the safest default for mixed-language
questions. The OCR pipeline:

1. Adds padding around the crop.
2. Upscales small captures.
3. Detects and corrects dark backgrounds.
4. Uses low-impact grayscale and contrast processing to preserve accents.
5. Retries with color detail when confidence is low.
6. Normalizes Vietnamese Unicode to NFC.

The extracted text remains editable. **Analyze Again** sends the corrected text
directly to local WebLLM without recapturing the page or rerunning OCR.

OCR quality still depends on source resolution, font size, contrast, crop
completeness, and visual noise.

## Development

```bash
npm ci
npm run check
npm run build
```

Available commands:

| Command | Description |
| --- | --- |
| `npm test` | Run Node.js unit tests |
| `npm run check` | Run syntax checks and unit tests |
| `npm run benchmark` | Validate benchmark fixtures and optional stored results |
| `npm run build` | Recreate the unpacked extension in `dist/` |
| `npm run version:sync` | Copy the package version into `manifest.json` |

## CI and Releases

GitHub Actions uses two workflows:

- `.github/workflows/ci.yml` runs checks and a production build for pull
  requests targeting `main` or `dev`, and for pushes to `dev`. The unpacked
  `dist/` directory is uploaded as a short-lived workflow artifact.
- `.github/workflows/release.yml` runs whenever a change is merged or pushed
  to `main`. It increments the patch version, synchronizes extension metadata,
  runs checks, builds the extension, creates a ZIP and SHA-256 checksum,
  commits the release version, creates an annotated `vX.Y.Z` tag, and publishes
  a GitHub Release.

Example:

```text
0.9.4 on main
→ merge pull request
→ CI creates 0.9.5
→ tag v0.9.5
→ GitHub Release with quizbuddy-ai-0.9.5.zip
```

Repository settings must allow GitHub Actions to write repository contents:

1. Open **Settings → Actions → General**.
2. Under **Workflow permissions**, select **Read and write permissions**.
3. If `main` has branch protection or a ruleset, allow the GitHub Actions bot
   to create the release version commit, or exempt this release workflow from
   the push restriction.

The release commit contains `[skip ci]`. GitHub also does not recursively
trigger a new workflow from a push made with the repository `GITHUB_TOKEN`, so
the automated version commit does not create an infinite release loop.

## Accuracy Benchmark

The text-based benchmark lives in `benchmark/`. It validates prompt
construction for all fixtures and can compare stored WebLLM JSON output
without requiring Chrome automation.

```bash
npm run benchmark
npm run benchmark -- --results benchmark/sample-results.example.json
```

The first command is a fixture and prompt-regression smoke test. The second
also reports answer matches, core-concept keyword matches, and failed cases.
See `benchmark/fixtures/README.md` before adding anonymized OCR examples.

Generated files, dependencies, local browser data, logs, archives, and signing
keys are excluded by `.gitignore`.

## Project Structure

```text
quizbuddy-ai/
├── assets/                  # Source and generated-size extension icons
├── benchmark/               # Text fixtures and stored-result comparison
├── content/                 # Shadow DOM UI and styles
├── lib/                     # Testable processing utilities
├── scripts/                 # Reproducible extension build
├── test/                    # Unit and hostile-CSS fixtures
├── vendor/
│   ├── ocr/                 # OCR build notes
│   └── webllm/              # Runtime source/checksum documentation
├── background.js
├── manifest.json
├── offscreen.html
├── offscreen.js
└── package.json
```

## Troubleshooting

### WebGPU is unavailable

Update Chrome or Edge, enable hardware acceleration, restart the browser, and
inspect `chrome://gpu`.

### Model setup fails

Check first-run network access, available GPU memory, and the offscreen document
console from `chrome://extensions`. Try the Fast model on lower-memory devices.
Use **Delete Cache** and download again if a cached model is incomplete.

### OCR misses Vietnamese accents

Crop a larger and sharper region. Avoid cutting off accent marks near the top
of text lines. Ensure the complete question is visible at a readable zoom
level.

### The extension icon does not update

Click **Reload** on `chrome://extensions`. Chrome can cache toolbar icons; if
necessary, remove the unpacked extension and load `dist/` again.

### The extension does not appear

Chrome blocks content scripts on internal pages such as `chrome://extensions`.
Test on a regular website.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes.

Security issues should follow [SECURITY.md](SECURITY.md). Third-party component
licenses and model artifact details are documented in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

QuizBuddy AI is released under the [MIT License](LICENSE).
