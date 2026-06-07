export const DEFAULT_MODEL_ID = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";
export const DEFAULT_OCR_LANGUAGE = "auto";

export const MODEL_PROFILES = [
  {
    id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    label: "Fast (Lower Accuracy)",
    parameterLabel: "0.5B",
    description:
      "Lower memory use and faster startup, but weaker reasoning accuracy.",
    modelUrl:
      "https://huggingface.co/mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    runtimeFile:
      "Qwen2-0.5B-Instruct-q4f16_1-ctx4k_cs1k-webgpu.wasm",
    runtimeSha256:
      "eeef8ad5c1e668b066a3edc2e7f5d48e78d0749c869d87c00270406d95537c63",
    vramRequiredMB: 944.62
  },
  {
    id: DEFAULT_MODEL_ID,
    label: "Balanced",
    parameterLabel: "1.5B",
    description:
      "Moderate reasoning quality for devices with limited GPU memory.",
    modelUrl:
      "https://huggingface.co/mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    runtimeFile:
      "Qwen2-1.5B-Instruct-q4f16_1-ctx4k_cs1k-webgpu.wasm",
    runtimeSha256:
      "14ef8ff95b20cc099df70d365babd18dc8023936eeacc2f459bac21e0a4f9dfa",
    vramRequiredMB: 1629.75
  },
  {
    id: "Qwen2.5-3B-Instruct-q4f16_1-MLC",
    label: "Accurate (Recommended)",
    parameterLabel: "3B",
    description:
      "Stronger reasoning accuracy with a larger download and higher memory use.",
    modelUrl:
      "https://huggingface.co/mlc-ai/Qwen2.5-3B-Instruct-q4f16_1-MLC",
    runtimeFile:
      "Qwen2.5-3B-Instruct-q4f16_1-ctx4k_cs1k-webgpu.wasm",
    runtimeSha256:
      "5e03e730253a84b6d8f375ebcff7ffd194fe9633aff4380c34ccbf53c626877e",
    vramRequiredMB: 2504.76
  }
];

export const OCR_LANGUAGE_OPTIONS = [
  {
    id: "auto",
    label: "Auto (Vietnamese + English)",
    tesseractLanguages: "vie+eng"
  },
  {
    id: "vie",
    label: "Tiếng Việt",
    tesseractLanguages: "vie"
  },
  {
    id: "eng",
    label: "English",
    tesseractLanguages: "eng"
  },
  {
    id: "vie+eng",
    label: "Vietnamese + English",
    tesseractLanguages: "vie+eng"
  }
];

export function getModelProfile(modelId) {
  return (
    MODEL_PROFILES.find((profile) => profile.id === modelId) ||
    MODEL_PROFILES.find((profile) => profile.id === DEFAULT_MODEL_ID)
  );
}

export function normalizeOCRLanguage(language) {
  return OCR_LANGUAGE_OPTIONS.some((option) => option.id === language)
    ? language
    : DEFAULT_OCR_LANGUAGE;
}

export function getTesseractLanguages(language) {
  const normalizedLanguage = normalizeOCRLanguage(language);
  return OCR_LANGUAGE_OPTIONS.find(
    (option) => option.id === normalizedLanguage
  ).tesseractLanguages;
}
