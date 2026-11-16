#!/usr/bin/env node
/**
 * Explicit build entry point for the vendored `tray-icon-node` addon.
 *
 * Verifies `native/tray-icon-node` against `source-manifest.json`, then runs
 * `cargo build --release --locked` and writes `build-manifest.json` next to the
 * copied binary. `--check` reports the verified source/build state only.
 * @module scripts/for-os-build
 */
import { buildNative, inspectNative, verifySourceTree } from "./lib/native.mjs";

const process = globalThis.process;

const HELP = `Usage: node scripts/for-os-build.mjs [--check]

Builds the vendored tray-icon-node native addon from native/tray-icon-node
with cargo and writes build-manifest.json next to the binary.

  --check  verify the native source tree and report the existing build
  --help   show this help

Prerequisites: Rust stable (cargo, rustc) and, on Linux, the GTK/appindicator
development headers. Run \`npm run for-os:init\` to install them.`;

function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return 0;
  }
  const unknown = argv.filter((argument) => argument !== "--check");
  if (unknown.length) {
    console.error(`Unknown argument "${unknown[0]}".\n\n${HELP}`);
    return 2;
  }
  try {
    if (argv.includes("--check")) {
      inspectNative();
      return 0;
    }
    verifySourceTree();
    buildNative();
    return 0;
  } catch (failure) {
    console.error(
      `for-os-build: ${String(failure instanceof Error ? failure.message : failure)}`
    );
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));
