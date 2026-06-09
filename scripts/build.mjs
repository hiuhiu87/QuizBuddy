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
import { MODEL_PROFILES } from "../lib/app-config.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const packageJson = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8")
);
const webllmRuntimeBaseUrl =
  "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_48/";

await Promise.all(MODEL_PROFILES.map(ensureWebLLMRuntime));

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
  cp(path.join(root, "offscreen.html"), path.join(dist, "offscreen.html")),
  ...["16", "32", "48", "128"].map((size) =>
    cp(
      path.join(root, "assets", `icon-${size}.png`),
      path.join(dist, "assets", `icon-${size}.png`)
    )
  ),
  ...MODEL_PROFILES.map((profile) =>
    cp(
      path.join(root, "vendor", "webllm", profile.runtimeFile),
      path.join(dist, "vendor", "webllm", profile.runtimeFile)
    )
  ),
  cp(
    path.join(root, "node_modules", "tesseract.js", "dist", "worker.min.js"),
    path.join(dist, "vendor", "ocr", "worker.min.js")
  ),
]);

await build({
  entryPoints: [path.join(root, "background.js")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome116",
  outfile: path.join(dist, "background.js"),
  sourcemap: false,
  minify: false
});

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
manifest.version = packageJson.version;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Built QuizBuddy AI extension at ${dist}`);

async function ensureWebLLMRuntime(profile) {
  const webllmRuntimeName = profile.runtimeFile;
  const webllmRuntimePath = path.join(
    root,
    "vendor",
    "webllm",
    webllmRuntimeName
  );
  const webllmRuntimeUrl = webllmRuntimeBaseUrl + webllmRuntimeName;
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
  if (checksum !== profile.runtimeSha256) {
    throw new Error(
      `WebLLM runtime checksum mismatch. Expected ${profile.runtimeSha256}, received ${checksum}.`
    );
  }
}
