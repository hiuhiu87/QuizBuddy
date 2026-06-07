import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagePath = path.join(root, "package.json");
const packageLockPath = path.join(root, "package-lock.json");
const manifestPath = path.join(root, "manifest.json");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const packageLock = JSON.parse(await readFile(packageLockPath, "utf8"));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

validateChromeVersion(packageJson.version);
manifest.version = packageJson.version;
packageLock.version = packageJson.version;
if (packageLock.packages?.[""]) {
  packageLock.packages[""].version = packageJson.version;
}

await Promise.all([
  writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`
  ),
  writeFile(
    packageLockPath,
    `${JSON.stringify(packageLock, null, 2)}\n`
  )
]);

console.log(`Synchronized extension version ${packageJson.version}`);

function validateChromeVersion(version) {
  const parts = String(version).split(".");
  const isValid =
    parts.length >= 1 &&
    parts.length <= 4 &&
    parts.every(
      (part) =>
        /^\d+$/.test(part) &&
        Number(part) >= 0 &&
        Number(part) <= 65535
    );

  if (!isValid) {
    throw new Error(
      `Version ${version} is not compatible with Chrome extension version rules.`
    );
  }
}
