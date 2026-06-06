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
| `esbuild` | 0.25.5 | MIT | Development-time bundler |

The build downloads the compatible WebLLM model runtime from:

```text
vendor/webllm/Qwen2-1.5B-Instruct-q4f16_1-ctx4k_cs1k-webgpu.wasm
```

```text
https://github.com/mlc-ai/binary-mlc-llm-libs/tree/main/web-llm-models/v0_2_48
```

SHA-256:

```text
14ef8ff95b20cc099df70d365babd18dc8023936eeacc2f459bac21e0a4f9dfa
```

The runtime binary is not committed to the source repository. The build rejects
the file if its checksum differs.

Qwen2.5 model weights are not committed to the source repository. After
explicit user consent, WebLLM downloads model data from:

```text
https://huggingface.co/mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC
```

The upstream Qwen2.5-1.5B-Instruct model is published under Apache-2.0:

```text
https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct
```

Review dependency source distributions and lockfile metadata for complete
copyright notices and license texts.
