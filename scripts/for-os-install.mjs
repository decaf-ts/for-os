#!/usr/bin/env node
/**
 * Install-time materialization of the vendored `tray-icon-node` addon.
 *
 * Verifies `native/tray-icon-node` against `source-manifest.json`, builds the
 * native addon when a toolchain is available, and writes a verified copy to
 * `node_modules/tray-icon-node`. Without `--require-build` a missing toolchain
 * degrades to a binary-less install; the TypeScript bridges then report
 * unavailable at runtime instead of failing the package install.
 * @module scripts/for-os-install
 */
import { installNative, verifySourceTree } from "./lib/native.mjs";

const process = globalThis.process;

const HELP = `Usage: node scripts/for-os-install.mjs [--require-build]

Verifies native/tray-icon-node against source-manifest.json, builds the native
addon when possible, and materializes a verified copy at
node_modules/tray-icon-node.

  --require-build  fail instead of degrading when the native build cannot run
  --help           show this help`;

function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return 0;
  }
  const unknown = argv.filter((argument) => argument !== "--require-build");
  if (unknown.length) {
    console.error(`Unknown argument "${unknown[0]}".\n\n${HELP}`);
    return 2;
  }
  try {
    verifySourceTree();
    installNative({ required: argv.includes("--require-build") });
    return 0;
  } catch (failure) {
    console.error(
      `for-os-install: ${String(failure instanceof Error ? failure.message : failure)}`
    );
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));
