# WebLLM build assets

The WebLLM JavaScript package is bundled into `dist/offscreen.js` by esbuild.

The compatible Qwen2 1.5B WebGPU runtime is downloaded during `npm run build`
when it is not already present:

```text
Qwen2-1.5B-Instruct-q4f16_1-ctx4k_cs1k-webgpu.wasm
```

Model weights are downloaded from the official MLC Hugging Face repository on
first use and cached by WebLLM. They are data used by the locally bundled
runtime; no remote JavaScript module or external inference API is used.

The build verifies this SHA-256 before copying the runtime into `dist/`:

```text
14ef8ff95b20cc099df70d365babd18dc8023936eeacc2f459bac21e0a4f9dfa
```
