export function buildDeviceDiagnostics({
  webgpuAvailable,
  adapterInfo,
  selectedModelProfile,
  lastModelStatus = "not-loaded",
  lastModelError = ""
}) {
  const normalizedAdapterInfo =
    String(adapterInfo || "").trim() || "Unavailable in this browser";
  const normalizedError = String(lastModelError || "").trim();
  const errorLooksLikeOOM =
    /out of memory|insufficient memory|allocation|oom|memory limit/i.test(
      normalizedError
    );

  let recommendation = "Good fit";
  if (!webgpuAvailable) {
    recommendation =
      "WebGPU unavailable. Hardware acceleration may be disabled.";
  } else if (errorLooksLikeOOM) {
    recommendation = "Not enough memory. Try a smaller model.";
  } else if (lastModelStatus === "error") {
    recommendation = "Model loading failed. Try a smaller model.";
  } else if (selectedModelProfile?.vramRequiredMB >= 2400) {
    recommendation = "Try Balanced if loading fails.";
  }

  return {
    webgpuAvailable: Boolean(webgpuAvailable),
    adapterInfo: normalizedAdapterInfo,
    selectedModel: selectedModelProfile?.label || "Unknown",
    selectedModelId: selectedModelProfile?.id || "",
    estimatedVramMB: Number(selectedModelProfile?.vramRequiredMB) || 0,
    lastModelStatus,
    lastModelError: normalizedError,
    recommendation
  };
}
