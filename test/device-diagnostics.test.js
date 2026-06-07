import test from "node:test";
import assert from "node:assert/strict";
import { buildDeviceDiagnostics } from "../lib/device-diagnostics.js";

const profile = {
  id: "model",
  label: "Accurate",
  vramRequiredMB: 2504
};

test("diagnostics reports unavailable WebGPU and adapter fallback", () => {
  const result = buildDeviceDiagnostics({
    webgpuAvailable: false,
    selectedModelProfile: profile
  });

  assert.equal(result.webgpuAvailable, false);
  assert.equal(result.adapterInfo, "Unavailable in this browser");
  assert.match(result.recommendation, /WebGPU unavailable/);
});

test("diagnostics includes selected model memory estimate", () => {
  const result = buildDeviceDiagnostics({
    webgpuAvailable: true,
    adapterInfo: "Example GPU",
    selectedModelProfile: profile
  });

  assert.equal(result.estimatedVramMB, 2504);
  assert.equal(result.selectedModel, "Accurate");
});

test("diagnostics maps memory failures to a smaller model recommendation", () => {
  const result = buildDeviceDiagnostics({
    webgpuAvailable: true,
    selectedModelProfile: profile,
    lastModelStatus: "error",
    lastModelError: "GPU out of memory"
  });

  assert.match(result.recommendation, /smaller model/);
});
