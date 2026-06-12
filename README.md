# QuizBuddy AI

Privacy-first Chrome extension for answering cropped questions with local OCR,
browser-based WebLLM inference, or an optional OpenAI-compatible API provider.

QuizBuddy AI captures a user-selected region of the visible tab, extracts
Vietnamese or English text with Tesseract.js, and can use a selected local
Qwen model to produce an answer and learning explanation. Users can also opt
into an OpenAI-compatible API provider. In API mode, QuizBuddy can either send
OCR text or send the cropped image directly to a vision-capable API model. The
project operates without its own backend, account system, analytics, or
server-side history.

## Status

QuizBuddy AI is an MVP under active development. The crop, OCR, local model,
optional API provider, image-direct API analysis, result rendering, follow-up,
practice, and reliability flows are implemented.

## Highlights

- Chrome Extension Manifest V3
- Vanilla JavaScript, HTML, and CSS
- Crop-first visible-tab screenshot workflow
- Local WebGPU provider for offline inference after model setup
- Optional OpenAI-compatible API provider
- API-only direct cropped-image analysis for vision-capable models
- Browser-local Vietnamese and English OCR
- Local Math & Formula OCR (via ONNX runtime and transformers.js) to recognize complex equations
- Safe, isolated LaTeX math rendering inside Shadow DOM using KaTeX with inline base64 fonts
- Selectable OCR language and editable OCR text
- Multi-question crop analysis with independent answers and per-question evidence
- Quick Answer and Learning modes
- Subject-aware prompts for English, German, Math, law, science, history,
  geography, computer science, economics/business, language learning, and
  general knowledge
- Optional Check My Answer feedback
- OCR, AI, and overall reliability indicators with visible reasons
- OCR line numbering and answer source traces
- Local question-quality warnings for missing choices, passages, and visuals
- Cancellable task-scoped OCR, analysis, practice, and follow-up work
- Locally stored global or subject-specific custom instructions
- Session-only follow-up chat grounded in the current question
- Per-option analysis and compact learning examples
- Similar-practice generation with answer reveal
- Session-only concept notes
- True re-crop from the last in-memory screenshot
- Private WebGPU and model-fit diagnostics
- Browser-local WebLLM inference through WebGPU
- Explicit consent before downloading model weights
- Fast 0.5B, Balanced 1.5B, Accurate 3B, High Accuracy 7B, and Max Accuracy 8B local model profiles
- Model cache status, retry, switching, and deletion controls
- API base URL, key, and model-name controls for compatible providers
- `Alt+Shift+Q` crop shortcut
- Full answer text instead of invented A/B/C/D labels
- Closed Shadow DOM UI isolation
- No QuizBuddy backend, account, analytics, or persistent study history

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- Chrome or Edge 116 or newer
- For Local WebGPU mode: WebGPU, browser hardware acceleration, and
  approximately 945 MB to 5.7 GB of available GPU memory depending on model
- For API mode: an OpenAI-compatible chat completions endpoint and model. The
  direct-image option requires a vision-capable model that accepts `image_url`
  message content.

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
3. Choose a provider:
   - **Local WebGPU (No Internet)** for browser-local inference after model
     download.
   - **OpenAI Compatible API** for a configured API base URL, API key, and model
     name.
4. For Local WebGPU, select a local model, review the model notice, and click
   the download/load button yourself. Wait for model setup to complete.
5. For API mode, save the API settings. If the API model supports vision, you
   can enable **Send cropped image directly to API and skip OCR text**.
6. Click **Crop Question**.
7. Drag over one or more questions. Include each question's answer choices
   when they exist; question-only crops are also supported.
8. In OCR mode, correct the OCR text if needed and click **Analyze Again**.
   In API image-direct mode, the crop is sent directly to the API model and the
   OCR editor is skipped.
9. Review the suggested answer and explanation.

Use **Quick Answer** for a compact result or **Learning Mode** for option
analysis, core knowledge, study notes, and practice generation. Select a
subject preset when specialized guidance is useful. Enable **Check my answer**
and enter a label or free-text answer before cropping or analyzing again to
receive learning-oriented feedback.

Question-quality checks run after OCR-based capture. Warnings do not block
analysis, while serious issues offer **Analyze anyway**, **Edit OCR**, and
**Crop again**. Analyzing despite a serious warning lowers the displayed
reliability. API image-direct mode relies on the API model reading the cropped
image and does not have OCR line confidence.

After a successful analysis, use **Ask Follow-up** or its quick actions to ask
about the current question. Follow-up messages are kept only in the current
sidebar session. Custom instructions can be saved globally or for the current
subject in Chrome local storage; they cannot override the JSON, evidence, or
insufficient-information rules.

Follow-up answers stream into the sidebar as they are generated. Requests that
name a question number use only that question's OCR lines when available and
compact analysis context, reducing prompt processing and first-token latency.
For API image-direct results, follow-up context is based on the parsed question
and answer fields because no OCR line numbers exist. Follow-up output is capped
to a concise response and interrupted after 45 seconds.

After a capture, **Re-crop screenshot** opens the same full screenshot in a
temporary modal. It does not call `captureVisibleTab` again. The screenshot is
kept only in offscreen memory and is cleared when the sidebar session closes.

Press `Alt+Shift+Q` to start cropping and `Escape` to cancel crop mode. Chrome
allows changing the shortcut at `chrome://extensions/shortcuts`.

Drag the floating icon toward the right edge to collapse it into a small edge
handle. Click the handle to expand the icon, then click the icon to open
QuizBuddy AI. A normal click still opens the sidebar, while a completed drag
does not trigger it accidentally. The docked state is saved in Chrome storage.

## AI Providers

QuizBuddy supports two provider modes:

- **Local WebGPU (No Internet)** uses the selected browser-local WebLLM model
  after the model weights have been downloaded and cached. OCR, prompt
  construction, inference, parsing, reliability scoring, practice, and
  follow-up work run inside the extension.
- **OpenAI Compatible API** sends requests to the configured API base URL using
  the saved API key and model name. OCR-based API analysis sends the editable
  OCR text. The **Send cropped image directly to API and skip OCR text** option
  is available only in API mode and sends the cropped image data URL to a
  vision-capable chat completions model using `image_url` message content.

API settings are stored in Chrome local storage for the extension. QuizBuddy
does not operate a proxy or backend for these API calls.

## Model Download

Executable extension code, OCR workers, OCR WebAssembly, Vietnamese and English
language data, and the compatible WebLLM runtime are bundled into `dist/`.
During a source build, the official runtime artifact is downloaded when absent
and verified against a pinned SHA-256 checksum.

The Fast profile uses Qwen2.5 0.5B with lower memory use. Balanced uses
Qwen2.5 1.5B for moderate reasoning on constrained devices. The recommended
Accurate profile uses Qwen2.5 3B and about 2.5 GB of GPU memory for materially
stronger reasoning. High Accuracy uses Qwen2.5 7B and Max Accuracy uses Qwen3
8B for higher-quality local reasoning on devices with about 5.1 GB to 5.7 GB
of available GPU memory. QuizBuddy AI never starts a
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
  - Provider, local model, API, OCR language, editable text, and image-direct controls
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
  - OpenAI-compatible API calls for OCR text and API-only image-direct analysis
  - AI JSON validation, reliability scoring, and practice generation
  - Question-quality checks, source traces, and grounded follow-up inference
  - Temporary full-screenshot memory and device diagnostics
```

## Privacy

In **Local WebGPU** mode, QuizBuddy AI does not send question screenshots, OCR
text, prompts, answers, follow-up messages, or practice requests to an external
AI inference API. Local model inference runs in the browser through WebGPU after
the selected model weights are downloaded.

In **OpenAI Compatible API** mode, QuizBuddy sends the selected request content
to the configured API endpoint:

- OCR-based API analysis sends OCR text and the analysis prompt.
- API image-direct analysis sends the cropped image data URL and the analysis
  prompt to a vision-capable API model.
- API follow-up and practice requests send the current question context and
  prompt content needed for that task.

QuizBuddy AI itself does not:

- Operate a backend
- Proxy API requests through a QuizBuddy server
- Store question history
- Persist screenshots, practice questions, or session study notes
- Persist follow-up messages or analysis results
- Require login
- Include analytics or tracking

API keys and provider settings are stored in Chrome local storage for the
extension. The first local model setup downloads model artifacts from the
official MLC repository. This is a model download, not remote inference.

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

WebLLM, OCR, API calls, and image processing are intentionally run from the
extension's background/offscreen flow, not directly inside the webpage content
script. To reduce impact on the active page:

- Only one Tesseract worker is kept at a time, even when OCR language changes.
- Closing the sidebar releases WebLLM GPU memory and terminates the OCR worker.
- Compute resources are also released shortly after a completed OCR/AI task.
- The offscreen document can remain briefly for re-crop, but the model and OCR
  worker are unloaded; closing the sidebar clears the temporary screenshot.
- A temporary offscreen document used only for cache inspection is closed
  immediately after the check.
- API mode does not load a local WebLLM model unless a local task explicitly
  needs it. It still uses the offscreen document for crop processing and
  request orchestration.

Local processing can still temporarily use substantial CPU, RAM, and GPU while
OCR or inference is actively running.

Cancellation is cooperative. QuizBuddy calls WebLLM's generation interrupt
when the installed runtime exposes it, terminates the active OCR worker when
possible, and always suppresses stale results by task ID. Since the main model
response is structured JSON, the UI streams named progress stages rather than
showing incomplete raw JSON tokens.

## Answer Accuracy

For the best available local accuracy:

- Use **Accurate (Recommended)** for the strongest available local reasoning.
- Treat **Balanced** as a memory-conscious compromise, not a high-accuracy model.
- Select the question's specific OCR language when it is known.
- Include the complete question. Include every answer choice when the source
  is multiple-choice.
- Correct OCR mistakes and use **Analyze Again** before trusting a low-confidence result.
- For screenshots with diagrams, tables, charts, or dense formulas, API mode
  with **Send cropped image directly to API and skip OCR text** can preserve
  visual context that OCR cannot represent. This requires a vision-capable API
  model and sends the crop to the configured API endpoint.

Local inference uses deterministic decoding, a 4096-token context window, and an
accuracy prompt that splits multi-question crops, solves every question
independently, and associates repeated A/B/C/D labels only with their own
question. Standalone markers such as `Câu 1.` are recognized even when OCR
loses accents or reads them as `Cau`/`Côu`. Output capacity scales with the
detected question count. Crops containing two or more questions use a compact
batch schema to reduce latency and malformed output. If the local model returns
fewer questions or an avoidable `Unknown`, QuizBuddy recovers bounded groups of
up to four question scopes and merges the results. Crops with five or more
questions skip the large initial request and start with two-question groups.
A failed group is split into single questions, while completed groups are
preserved, so one timeout does not discard the entire batch. Each generation
and the full analysis have finite time budgets. OCR confidence affects the
displayed reliability but does not by itself force an `Unknown` answer. If no
choices are visible, the extension switches to direct-answer behavior and
returns the answer content with no option label. The extension still cannot
guarantee a correct answer.

OpenAI-compatible API analysis uses the same JSON parsing and reliability
normalization path where possible. If the API returns prose, malformed JSON, or
an unusable `Unknown`, QuizBuddy retries with a compact JSON-only prompt before
showing the parsed result or a low-reliability fallback.

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
directly to the selected provider without recapturing the page or rerunning OCR.
For Local WebGPU this stays in browser-local WebLLM. For API mode it sends the
edited text to the configured API endpoint.

When **Send cropped image directly to API and skip OCR text** is enabled, the
OCR pipeline is skipped for that capture. This option is disabled in Local
WebGPU mode and only appears as active when the OpenAI-compatible API provider
is selected.

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
│   ├── math-ocr/            # Math OCR model/runtime notes
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

### API analysis returns Unknown

Check the API base URL, API key, model name, and whether the provider supports
OpenAI-compatible `/chat/completions` requests with JSON responses. For
image-direct mode, use a vision-capable model that supports `image_url` message
content. The extension logs raw AI responses to the page console as
`[QuizBuddy raw AI] ...` for debugging malformed API or model output.

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
