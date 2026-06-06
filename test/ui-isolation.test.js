import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("content UI is isolated in a closed Shadow Root", async () => {
  const source = await readFile("content/content.js", "utf8");

  assert.match(source, /attachShadow\(\{\s*mode:\s*"closed"\s*\}\)/);
  assert.match(source, /shadowRoot\.append\(floatingButton,\s*sidebar\)/);
  assert.match(source, /shadowRoot\.append\(cropOverlay\)/);
  assert.match(source, /element\.style\.setProperty\(property,\s*value,\s*"important"\)/);
});

test("content CSS resets the shadow host", async () => {
  const css = await readFile("content/content.css", "utf8");

  assert.match(css, /:host\s*\{[\s\S]*all:\s*initial;/);
  assert.match(css, /:host \*,[\s\S]*box-sizing:\s*border-box;/);
});

test("manifest does not inject CSS into the webpage document", async () => {
  const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
  const contentScript = manifest.content_scripts[0];

  assert.equal(contentScript.css, undefined);
  assert.equal(manifest.web_accessible_resources, undefined);
});

test("floating and toolbar buttons use packaged icons", async () => {
  const source = await readFile("content/content.js", "utf8");
  const manifest = JSON.parse(await readFile("manifest.json", "utf8"));

  assert.match(source, /import floatingIconUrl from "\.\.\/assets\/icon\.png"/);
  assert.doesNotMatch(source, /chrome\.runtime\.getURL\("icon\.png"\)/);
  assert.equal(manifest.action.default_icon["16"], "assets/icon-16.png");
  assert.equal(manifest.action.default_icon["32"], "assets/icon-32.png");
  assert.equal(manifest.icons["128"], "assets/icon-128.png");
});
