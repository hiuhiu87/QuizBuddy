# Third-Party Notices

QuizBuddy AI is licensed under the MIT License. It also builds with and
distributes components from third-party projects under their respective
licenses.

| Component | Version | License | Usage |
| --- | --- | --- | --- |
| `@mlc-ai/web-llm` | 0.2.79 | Apache-2.0 | Browser-local LLM runtime |
| `tesseract.js` | 6.0.1 | Apache-2.0 | Browser-local OCR API and worker |
| `tesseract.js-core` | 6.1.2 | Apache-2.0 | Tesseract WebAssembly runtime |
| `@tesseract.js-data/eng` | 1.0.0 | MIT | English OCR language data |
| `@tesseract.js-data/vie` | 1.0.0 | MIT | Vietnamese OCR language data |
| `@huggingface/transformers` | 4.2.0 | Apache-2.0 | Browser-local ONNX Inference pipeline |
| `katex` | 0.17.0 | MIT | Safe browser-local LaTeX formula rendering |
| `esbuild` | 0.25.5 | MIT | Development-time bundler |

The build downloads compatible WebLLM model runtimes from:

```text
vendor/webllm/Qwen2-0.5B-Instruct-q4f16_1-ctx4k_cs1k-webgpu.wasm
vendor/webllm/Qwen2-1.5B-Instruct-q4f16_1-ctx4k_cs1k-webgpu.wasm
vendor/webllm/Qwen2.5-3B-Instruct-q4f16_1-ctx4k_cs1k-webgpu.wasm
vendor/webllm/Qwen2-7B-Instruct-q4f16_1-ctx4k_cs1k-webgpu.wasm
vendor/webllm/Qwen3-8B-q4f16_1-ctx4k_cs1k-webgpu.wasm
```

```text
https://github.com/mlc-ai/binary-mlc-llm-libs/tree/main/web-llm-models/v0_2_48
```

SHA-256:

```text
eeef8ad5c1e668b066a3edc2e7f5d48e78d0749c869d87c00270406d95537c63
14ef8ff95b20cc099df70d365babd18dc8023936eeacc2f459bac21e0a4f9dfa
5e03e730253a84b6d8f375ebcff7ffd194fe9633aff4380c34ccbf53c626877e
1d4d494a8a50937491cc789d77fe3fcf0859dd8005cbf5603cc6c1a8efcc6227
6bfc549989b3beb2863cf3b97e0030c635c10518aebf3e27ff172dea0f06d8bd
```

Runtime binaries are not committed to the source repository. The build rejects
any file if its checksum differs.

Qwen model weights are not committed to the source repository. After explicit
user consent, WebLLM downloads model data from:

```text
https://huggingface.co/mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC
https://huggingface.co/mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC
https://huggingface.co/mlc-ai/Qwen2.5-3B-Instruct-q4f16_1-MLC
https://huggingface.co/mlc-ai/Qwen2.5-7B-Instruct-q4f16_1-MLC
https://huggingface.co/mlc-ai/Qwen3-8B-q4f16_1-MLC
```

The upstream Qwen base and instruct models are published under Apache-2.0:

```text
https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct
https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct
https://huggingface.co/Qwen/Qwen2.5-3B-Instruct
https://huggingface.co/Qwen/Qwen2.5-7B-Instruct
https://huggingface.co/Qwen/Qwen3-8B
```

Review dependency source distributions and lockfile metadata for complete
copyright notices and license texts.
