# Contributing to QuizBuddy AI

Thank you for considering a contribution.

## Scope

QuizBuddy AI is intentionally focused on a crop-first, browser-local workflow:

1. Capture a visible-tab region.
2. Run OCR locally.
3. Analyze extracted text with WebLLM locally.
4. Render a concise learning-oriented result.

Keep proposals within this architecture unless a broader change has been
discussed first. Do not introduce external AI APIs, API keys, a backend, login,
tracking, or remote executable code.

## Development setup

Requirements:

- Node.js 20 or newer
- npm 10 or newer
- Chrome or Edge 116 or newer
- A WebGPU-capable device for end-to-end model testing

```bash
npm ci
npm run check
npm run build
```

Load the generated `dist/` directory from `chrome://extensions`.

## Pull requests

- Keep changes focused and explain their user-visible impact.
- Add or update tests for parsing, crop calculations, UI isolation, or other
  deterministic behavior.
- Run `npm run check` and `npm run build` before submitting.
- Do not commit `node_modules/`, `dist/`, browser profiles, model cache files,
  logs, or extension signing keys.
- Preserve Manifest V3 restrictions and keep all executable extension code
  bundled locally.
- Maintain the `qb-` CSS prefix and closed Shadow DOM isolation.

## Testing

Automated tests cover deterministic JavaScript behavior. Changes involving
OCR, screenshots, WebGPU, or model output also require manual Chrome testing.

Test both English and Vietnamese questions, browser zoom levels, high-DPI
displays, dark backgrounds, unlabeled choices, and pages with aggressive
global CSS resets.

## Commit messages

Use short, imperative commit subjects, for example:

```text
Improve Vietnamese OCR preprocessing
Fix floating icon asset path
Guard option labels against OCR text
```

## Release process

Do not create routine release tags manually. Merging into `main` triggers the
release workflow, which increments the patch version, builds the extension,
creates the `vX.Y.Z` tag, and publishes the ZIP and checksum.

Keep `package.json` and `manifest.json` versions aligned. Run
`npm run version:sync` after changing the package version manually for an
exceptional major or minor release.

## Licensing

By contributing, you agree that your contributions will be licensed under the
MIT License included in this repository.
