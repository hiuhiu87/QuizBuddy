# QuizBuddy AI

Privacy-first Chrome extension for analyzing multiple-choice questions with
local OCR and browser-based WebLLM inference.

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
- Browser-local WebLLM inference through WebGPU
- Explicit consent before downloading model weights
- Fast (0.5B) and Balanced (1.5B) local model profiles
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
- Approximately 945 MB to 1.63 GB of available GPU memory, depending on model

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
7. Drag over the complete question and its answer choices.
8. Correct the OCR text if needed and click **Analyze Again**.
9. Review the suggested answer and explanation.

Press `Alt+Shift+Q` to start cropping and `Escape` to cancel crop mode. Chrome
allows changing the shortcut at `chrome://extensions/shortcuts`.

## Model Download

Executable extension code, OCR workers, OCR WebAssembly, Vietnamese and English
language data, and the compatible WebLLM runtime are bundled into `dist/`.
During a source build, the official runtime artifact is downloaded when absent
and verified against a pinned SHA-256 checksum.

The Fast profile uses Qwen2.5 0.5B with lower memory use. The Balanced profile
uses Qwen2.5 1.5B for better analysis quality. QuizBuddy AI never starts a
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
  - Progress and result rendering

Background Service Worker
  - Visible-tab screenshot capture
  - Offscreen document lifecycle
  - Request and progress routing

Offscreen Document
  - Canvas crop and OCR preprocessing
  - Selectable Vietnamese/English Tesseract.js OCR
  - Multi-model WebLLM setup, cache management, and inference
  - AI JSON validation and normalization
```

## Privacy

QuizBuddy AI does not:

- Send question screenshots or OCR text to Gemini, OpenAI, or another AI API
- Require an API key
- Operate a backend
- Store question history
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
host element with critical inline `!important` layout declarations.

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
| `npm run build` | Recreate the unpacked extension in `dist/` |

Generated files, dependencies, local browser data, logs, archives, and signing
keys are excluded by `.gitignore`.

## Project Structure

```text
quizbuddy-ai/
├── assets/                  # Source and generated-size extension icons
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
