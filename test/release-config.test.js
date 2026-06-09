import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("source package and extension manifest versions stay aligned", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const packageLock = JSON.parse(
    await readFile("package-lock.json", "utf8")
  );
  const manifest = JSON.parse(await readFile("manifest.json", "utf8"));

  assert.equal(manifest.version, packageJson.version);
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[""].version, packageJson.version);
});

test("build reads the package version instead of hardcoding a release", async () => {
  const source = await readFile("scripts/build.mjs", "utf8");

  assert.match(source, /manifest\.version = packageJson\.version/);
  assert.doesNotMatch(source, /manifest\.version = "\d+\.\d+\.\d+"/);
});

test("build bundles the module-based background service worker", async () => {
  const buildScript = await readFile(
    new URL("../scripts/build.mjs", import.meta.url),
    "utf8"
  );
  assert.match(buildScript, /entryPoints: \[path\.join\(root, "background\.js"\)\]/);
  assert.match(buildScript, /format: "esm"/);
});

test("main release workflow checks, builds, tags, and publishes a zip", async () => {
  const workflow = await readFile(
    ".github/workflows/release.yml",
    "utf8"
  );

  assert.match(workflow, /branches:\n\s+- main/);
  assert.match(workflow, /npm run check/);
  assert.match(workflow, /npm version patch --no-git-tag-version/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /git tag -a/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /gh release upload/);
  assert.match(workflow, /--clobber/);
  assert.match(workflow, /zip\.sha256/);
});
