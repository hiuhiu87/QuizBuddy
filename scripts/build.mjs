import {
  access,
  cp,
  mkdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const webllmRuntimeName =
  "Qwen2-1.5B-Instruct-q4f16_1-ctx4k_cs1k-webgpu.wasm";
const webllmRuntimePath = path.join(
  root,
  "vendor",
  "webllm",
  webllmRuntimeName
);
const webllmRuntimeUrl =
  "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_48/" +
  webllmRuntimeName;
const webllmRuntimeSha256 =
  "14ef8ff95b20cc099df70d365babd18dc8023936eeacc2f459bac21e0a4f9dfa";

await ensureWebLLMRuntime();

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, "content"), { recursive: true });
await mkdir(path.join(dist, "assets"), { recursive: true });
await mkdir(path.join(dist, "vendor", "ocr", "core"), { recursive: true });
await mkdir(path.join(dist, "vendor", "ocr", "lang-data"), {
  recursive: true
});
await mkdir(path.join(dist, "vendor", "webllm"), { recursive: true });

await Promise.all([
  cp(path.join(root, "manifest.json"), path.join(dist, "manifest.json")),
  cp(path.join(root, "background.js"), path.join(dist, "background.js")),
  cp(path.join(root, "offscreen.html"), path.join(dist, "offscreen.html")),
  ...["16", "32", "48", "128"].map((size) =>
    cp(
      path.join(root, "assets", `icon-${size}.png`),
      path.join(dist, "assets", `icon-${size}.png`)
    )
  ),
  cp(
    path.join(
      root,
      "vendor",
      "webllm",
      webllmRuntimeName
    ),
    path.join(
      dist,
      "vendor",
      "webllm",
      webllmRuntimeName
    )
  ),
  cp(
    path.join(root, "node_modules", "tesseract.js", "dist", "worker.min.js"),
    path.join(dist, "vendor", "ocr", "worker.min.js")
  ),
]);

await build({
  entryPoints: [path.join(root, "content", "content.js")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome116",
  outfile: path.join(dist, "content", "content.js"),
  sourcemap: false,
  minify: false,
  loader: {
    ".css": "text",
    ".png": "dataurl"
  }
});

const tesseractCoreFiles = [
  "tesseract-core.wasm.js",
  "tesseract-core.wasm",
  "tesseract-core-simd.wasm.js",
  "tesseract-core-simd.wasm",
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-lstm.wasm",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm"
];
await Promise.all(
  tesseractCoreFiles.map((file) =>
    cp(
      path.join(root, "node_modules", "tesseract.js-core", file),
      path.join(dist, "vendor", "ocr", "core", file)
    )
  )
);

const ocrLanguages = ["eng", "vie"];
await Promise.all(
  ocrLanguages.map((language) =>
    cp(
      path.join(
        root,
        "node_modules",
        "@tesseract.js-data",
        language,
        "4.0.0_best_int",
        `${language}.traineddata.gz`
      ),
      path.join(
        dist,
        "vendor",
        "ocr",
        "lang-data",
        `${language}.traineddata.gz`
      )
    )
  )
);

await build({
  entryPoints: [path.join(root, "offscreen.js")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome116",
  outfile: path.join(dist, "offscreen.js"),
  sourcemap: false,
  minify: false,
  define: {
    "process.env.NODE_ENV": JSON.stringify("production")
  }
});

const manifestPath = path.join(dist, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.version = "0.7.0";
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Built QuizBuddy AI extension at ${dist}`);

async function ensureWebLLMRuntime() {
  await mkdir(path.dirname(webllmRuntimePath), { recursive: true });

  try {
    await access(webllmRuntimePath);
  } catch {
    console.log(`Downloading WebLLM runtime: ${webllmRuntimeName}`);
    const response = await fetch(webllmRuntimeUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to download WebLLM runtime: HTTP ${response.status}`
      );
    }
    await writeFile(
      webllmRuntimePath,
      Buffer.from(await response.arrayBuffer())
    );
  }

  const runtime = await readFile(webllmRuntimePath);
  const checksum = createHash("sha256").update(runtime).digest("hex");
  if (checksum !== webllmRuntimeSha256) {
    throw new Error(
      `WebLLM runtime checksum mismatch. Expected ${webllmRuntimeSha256}, received ${checksum}.`
    );
  }
}
