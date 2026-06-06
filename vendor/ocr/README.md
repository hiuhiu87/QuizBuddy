# OCR build assets

OCR runtime files are generated into `dist/vendor/ocr` by:

```bash
npm run build
```

The build copies:

- Tesseract.js browser worker from `tesseract.js`.
- All compatible SIMD/LSTM core loaders and WASM files from
  `tesseract.js-core`.
- English integer language data from `@tesseract.js-data/eng`.
- Vietnamese integer language data from `@tesseract.js-data/vie`.

Do not add CDN script references. Source dependencies are pinned in
`package.json` and `package-lock.json`.
