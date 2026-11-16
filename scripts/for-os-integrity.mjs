#!/usr/bin/env node
/**
 * Re-records `native/tray-icon-node/source-manifest.json`.
 *
 * Regenerating the pin is a security-relevant change: review the native source
 * diff before committing the new manifest.
 * @module scripts/for-os-integrity
 */
import { writeSourceManifest } from "./lib/native.mjs";

const process = globalThis.process;

const HELP = `Usage: node scripts/for-os-integrity.mjs [--check]

Records the SHA-512 of every native source file and the canonical source-tree
digest in native/tray-icon-node/source-manifest.json.

  --check  verify the current tree against the manifest instead of rewriting it
  --help   show this help`;

async function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return 0;
  }
  const unknown = argv.filter((argument) => argument !== "--check");
  if (unknown.length) {
    console.error(`Unknown argument "${unknown[0]}".\n\n${HELP}`);
    return 2;
  }
  if (argv.includes("--check")) {
    const { verifySourceTree } = await import("./lib/native.mjs");
    verifySourceTree();
    console.log("for-os-integrity: native source matches source-manifest.json.");
    return 0;
  }
  const manifest = writeSourceManifest();
  console.log(
    `for-os-integrity: recorded ${Object.keys(manifest.files).length} files (source digest ${manifest.sourceDigest}).`
  );
  return 0;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (failure) {
  console.error(
    `for-os-integrity: ${String(failure instanceof Error ? failure.message : failure)}`
  );
  process.exitCode = 1;
}
