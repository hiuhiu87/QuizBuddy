export const DEFAULT_MODEL_ID = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";
export const DEFAULT_OCR_LANGUAGE = "auto";
export const DEFAULT_ANALYSIS_MODE = "learning";
export const DEFAULT_SUBJECT_PRESET = "auto";

export const ANALYSIS_MODES = [
  {
    id: "quick",
    label: "Quick Answer"
  },
  {
    id: "learning",
    label: "Learning Mode"
  }
];

export const SUBJECT_PRESETS = [
  { id: "auto", label: "Auto" },
  { id: "english", label: "English" },
  { id: "german", label: "German" },
  { id: "math", label: "Math" },
  { id: "general-knowledge", label: "General Knowledge" },
  { id: "law", label: "Law" }
];

export const MODEL_PROFILES = [
  {
    id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    label: "Fast (Lower Accuracy)",
    familyLabel: "Qwen2.5",
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
    familyLabel: "Qwen2.5",
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
    familyLabel: "Qwen2.5",
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
  },
  {
    id: "Qwen2.5-7B-Instruct-q4f16_1-MLC",
    label: "High Accuracy",
    familyLabel: "Qwen2.5",
    parameterLabel: "7B",
    description:
      "Stronger reasoning accuracy for high-memory devices, with slower setup and inference.",
    modelUrl:
      "https://huggingface.co/mlc-ai/Qwen2.5-7B-Instruct-q4f16_1-MLC",
    runtimeFile:
      "Qwen2-7B-Instruct-q4f16_1-ctx4k_cs1k-webgpu.wasm",
    runtimeSha256:
      "1d4d494a8a50937491cc789d77fe3fcf0859dd8005cbf5603cc6c1a8efcc6227",
    vramRequiredMB: 5106.67
  },
  {
    id: "Qwen3-8B-q4f16_1-MLC",
    label: "Max Accuracy",
    familyLabel: "Qwen3",
    parameterLabel: "8B",
    description:
      "Highest local reasoning profile for very high-memory devices, with the slowest setup and inference.",
    modelUrl:
      "https://huggingface.co/mlc-ai/Qwen3-8B-q4f16_1-MLC",
    runtimeFile:
      "Qwen3-8B-q4f16_1-ctx4k_cs1k-webgpu.wasm",
    runtimeSha256:
      "6bfc549989b3beb2863cf3b97e0030c635c10518aebf3e27ff172dea0f06d8bd",
    vramRequiredMB: 5695.78
  }
];

export const OCR_LANGUAGE_OPTIONS = [
  {
    id: "auto",
    label: "Auto",
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

export function normalizeAnalysisMode(mode) {
  return ANALYSIS_MODES.some((option) => option.id === mode)
    ? mode
    : DEFAULT_ANALYSIS_MODE;
}

export function normalizeSubjectPreset(subject) {
  return SUBJECT_PRESETS.some((option) => option.id === subject)
    ? subject
    : DEFAULT_SUBJECT_PRESET;
}

export function getSubjectPreset(subject) {
  const normalizedSubject = normalizeSubjectPreset(subject);
  return SUBJECT_PRESETS.find(
    (option) => option.id === normalizedSubject
  );
}
