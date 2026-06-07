# WebLLM build assets

The WebLLM JavaScript package is bundled into `dist/offscreen.js` by esbuild.

Compatible Qwen2 WebGPU runtimes are downloaded during `npm run build` when
they are not already present:

```text
Qwen2-0.5B-Instruct-q4f16_1-ctx4k_cs1k-webgpu.wasm
Qwen2-1.5B-Instruct-q4f16_1-ctx4k_cs1k-webgpu.wasm
```

Model weights are downloaded from the official MLC Hugging Face repository on
first use and cached by WebLLM. They are data used by the locally bundled
runtime; no remote JavaScript module or external inference API is used.

The build verifies these SHA-256 checksums before copying the runtimes into
`dist/`:

```text
eeef8ad5c1e668b066a3edc2e7f5d48e78d0749c869d87c00270406d95537c63
14ef8ff95b20cc099df70d365babd18dc8023936eeacc2f459bac21e0a4f9dfa
```
