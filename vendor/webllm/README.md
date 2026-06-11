# WebLLM build assets

The WebLLM JavaScript package is bundled into `dist/offscreen.js` by esbuild.

Compatible Qwen WebGPU runtimes are downloaded during `npm run build` when they
are not already present:

```text
Qwen2-0.5B-Instruct-q4f16_1-ctx4k_cs1k-webgpu.wasm
Qwen2-1.5B-Instruct-q4f16_1-ctx4k_cs1k-webgpu.wasm
Qwen2.5-3B-Instruct-q4f16_1-ctx4k_cs1k-webgpu.wasm
Qwen2-7B-Instruct-q4f16_1-ctx4k_cs1k-webgpu.wasm
Qwen3-8B-q4f16_1-ctx4k_cs1k-webgpu.wasm
```

Model weights are downloaded from the official MLC Hugging Face repository on
first use and cached by WebLLM. They are data used by the locally bundled
runtime; no remote JavaScript module or external inference API is used.

The build verifies these SHA-256 checksums before copying the runtimes into
`dist/`:

```text
eeef8ad5c1e668b066a3edc2e7f5d48e78d0749c869d87c00270406d95537c63
14ef8ff95b20cc099df70d365babd18dc8023936eeacc2f459bac21e0a4f9dfa
5e03e730253a84b6d8f375ebcff7ffd194fe9633aff4380c34ccbf53c626877e
1d4d494a8a50937491cc789d77fe3fcf0859dd8005cbf5603cc6c1a8efcc6227
6bfc549989b3beb2863cf3b97e0030c635c10518aebf3e27ff172dea0f06d8bd
```
