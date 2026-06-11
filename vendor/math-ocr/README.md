# Math OCR Model & Runtime

This directory (or rather, the transformers.js browser environment) handles the local Math OCR (formula recognition) model.

## Model Details

- **Model ID:** `Xenova/texify` (VikParuchuri/texify variant)
- **Format:** ONNX format (quantized INT8)
- **Size:** ~25-30MB
- **Inference Runtime:** ONNX Runtime Web (`onnxruntime-web`) using WASM (Simd-threaded).

## Caching Behavior

Transformers.js caches the model files locally using the browser's Cache Storage API in the Chrome/Edge profile context. This ensures:
1. No external network request is made after the model is downloaded once.
2. The extension remains fully local and functional offline.
3. Bundle size stays small since the weights are lazy-loaded on demand.

## WASM Files

WASM files for ONNX runtime are copied during build from `node_modules/onnxruntime-web/dist/` to `dist/vendor/onnx/`. These are loaded via `chrome.runtime.getURL()` to execute ONNX models securely under Manifest V3 CSP restrictions.
