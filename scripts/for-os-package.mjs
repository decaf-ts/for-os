#!/usr/bin/env node
/** Verifies that an npm package contains every supported native binary. */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  NATIVE_DIR,
  NATIVE_PACKAGE,
  NATIVE_VERSION,
  TARGET_BINARIES,
  sha512File,
  verifySourceTree,
} from "./lib/native.mjs";

const process = globalThis.process;
const write = process.argv.includes("--write");
const allowed = new Set(["--write", "--help", "-h"]);
const unknown = process.argv.slice(2).find((arg) => !allowed.has(arg));

if (unknown) {
  console.error(`Unknown argument "${unknown}". Usage: node scripts/for-os-package.mjs [--write]`);
  process.exitCode = 2;
} else if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: node scripts/for-os-package.mjs [--write]\nChecks that all release native binaries are present; --write records their SHA-512 digests.");
} else {
  try {
    const { observed } = verifySourceTree();
    const binaries = Object.fromEntries(
      Object.entries(TARGET_BINARIES).map(([target, filename]) => {
        const path = join(NATIVE_DIR, filename);
        if (!existsSync(path)) throw new Error(`Missing native binary for ${target}: ${filename}`);
        return [filename, sha512File(path)];
      })
    );
    if (write) {
      const manifest = {
        version: 2,
        package: NATIVE_PACKAGE,
        packageVersion: NATIVE_VERSION,
        sourceDigest: observed.sourceDigest,
        binaries,
      };
      writeFileSync(join(NATIVE_DIR, "build-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    }
    console.log(`for-os: verified ${Object.keys(binaries).length} packaged native binaries.`);
  } catch (error) {
    console.error(`for-os-package: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
