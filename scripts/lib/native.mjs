#!/usr/bin/env node
/**
 * Shared plumbing for the vendored `tray-icon-node` addon.
 *
 * Verifies `native/tray-icon-node` against `source-manifest.json`, builds the
 * NAPI-RS addon with `cargo build --release --locked`, and materializes a
 * verified copy at `node_modules/tray-icon-node`. Nothing downloads a binary
 * and no shell string is constructed: every external command receives an
 * argument vector.
 * @module scripts/lib/native
 */
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const process = globalThis.process;

/** Absolute package root of `@decaf-ts/for-os`. */
export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Vendored native source directory. */
export const NATIVE_DIR = join(PACKAGE_ROOT, "native", "tray-icon-node");

/** Checked-in manifest pinning the native source tree. */
export const SOURCE_MANIFEST = join(NATIVE_DIR, "source-manifest.json");

/** File name of the manifest written next to a locally built binary. */
export const BUILD_MANIFEST = "build-manifest.json";

/** Pinned package name of the vendored addon. */
export const NATIVE_PACKAGE = "tray-icon-node";

/** Pinned upstream version of the vendored addon. */
export const NATIVE_VERSION = "0.1.2";

const SKIP_DIRS = new Set(["target", "node_modules", ".git"]);
const SKIP_FILES = new Set([
  BUILD_MANIFEST,
  "source-manifest.json",
  "source-manifest.json.tmp",
]);
const BINARY_PATTERN = /^tray-icon-node\..+\.node$/;

/**
 * Converts a platform path to the forward-slash manifest form.
 * @param {string} value platform-specific path
 * @returns {string} path using forward slashes
 */
export function toPosix(value) {
  return value.split(sep).join("/");
}

/**
 * SHA-512 hex digest of arbitrary bytes.
 * @param {string|Buffer|Uint8Array} data bytes to hash
 * @returns {string} lowercase hex digest
 */
export function sha512(data) {
  return createHash("sha512").update(data).digest("hex");
}

/**
 * SHA-512 hex digest of one file.
 * @param {string} file file path
 * @returns {string} lowercase hex digest of the file contents
 */
export function sha512File(file) {
  return sha512(readFileSync(file));
}

/**
 * Canonical digest over the sorted `path\0digest` lines.
 * @param {Object<string, string>} files map of manifest path to file digest
 * @returns {string} SHA-512 digest of the canonical listing
 */
export function sourceDigest(files) {
  const canonical = Object.keys(files)
    .sort()
    .map((path) => `${path}\u0000${files[path]}`)
    .join("\n");
  return sha512(canonical);
}

/**
 * Lists every file that belongs to the native source pin.
 * @param {string} [directory] native source directory; defaults to {@link NATIVE_DIR}
 * @returns {string[]} sorted absolute file paths, excluding build outputs and manifests
 */
export function listSourceFiles(directory = NATIVE_DIR) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Unexpected symlink in native source: ${full}`);
      }
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`Unexpected non-file entry in native source: ${full}`);
      }
      if (SKIP_FILES.has(entry.name) || BINARY_PATTERN.test(entry.name)) continue;
      files.push(full);
    }
  };
  walk(directory);
  return files.sort();
}

/**
 * Hashes the current native source tree.
 * @param {string} [directory] native source directory; defaults to {@link NATIVE_DIR}
 * @returns {Object} `{ files, sourceDigest }` with per-file digests and the canonical digest
 */
export function recordSourceTree(directory = NATIVE_DIR) {
  const files = {};
  for (const file of listSourceFiles(directory)) {
    files[toPosix(relative(directory, file))] = sha512File(file);
  }
  return { files, sourceDigest: sourceDigest(files) };
}

/**
 * Reads the checked-in source manifest.
 * @param {string} [directory] native source directory; defaults to {@link NATIVE_DIR}
 * @returns {Object} parsed `source-manifest.json`
 */
export function readSourceManifest(directory = NATIVE_DIR) {
  return JSON.parse(readFileSync(join(directory, "source-manifest.json"), "utf8"));
}

/**
 * Writes `source-manifest.json` for the current native source tree.
 * @param {{upstream?: Record<string, string>}} [options] upstream provenance to keep
 * @return {Record<string, unknown>} the written manifest
 */
export function writeSourceManifest({ upstream } = {}) {
  const observed = recordSourceTree();
  const existing = existsSync(SOURCE_MANIFEST)
    ? JSON.parse(readFileSync(SOURCE_MANIFEST, "utf8"))
    : {};
  const manifest = {
    package: NATIVE_PACKAGE,
    version: NATIVE_VERSION,
    upstream:
      upstream ??
      existing.upstream ?? {
        repository: "https://github.com/nglmercer/tray-icon-node",
        commit: "cb91e86184ed8612bcdee904277b4d5e78d966c3",
      },
    sourceDigest: observed.sourceDigest,
    files: observed.files,
  };
  writeFileSync(SOURCE_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/**
 * Verifies the native source tree against `source-manifest.json`.
 * @param {string} [directory] native source directory; defaults to {@link NATIVE_DIR}
 * @returns {Object} `{ manifest, observed }` with the pinned and observed state
 * @throws {Error} when the file set or digest diverges from the manifest
 */
export function verifySourceTree(directory = NATIVE_DIR) {
  const manifest = readSourceManifest(directory);
  const observed = recordSourceTree(directory);
  if (manifest.sourceDigest !== observed.sourceDigest) {
    const expected = new Set(Object.keys(manifest.files));
    const actual = new Set(Object.keys(observed.files));
    const changed = Object.keys(observed.files).filter(
      (path) => manifest.files[path] !== observed.files[path]
    );
    const missing = [...expected].filter((path) => !actual.has(path));
    const extra = [...actual].filter((path) => !expected.has(path));
    throw new Error(
      `Native source does not match source-manifest.json (changed: [${changed.join(", ")}], missing: [${missing.join(", ")}], extra: [${extra.join(", ")}]). ` +
        "Review the change, then run `npm run for-os:integrity:record`."
    );
  }
  return { manifest, observed };
}

/**
 * Runs a command without a shell and returns a non-throwing result.
 * @param {string} command executable name or path
 * @param {string[]} args argument vector passed verbatim
 * @param {Object} [options] spawn options; `capture: true` pipes stdio instead of inheriting it
 * @returns {Object} `{ ok, status, stdout, stderr }`; `error` is set when the process could not start
 */
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    ...options,
  });
  if (result.error && result.status === null) {
    return {
      ok: false,
      status: null,
      error: result.error,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  }
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/**
 * Returns the first line of a tool's version output, or undefined.
 * @param {string} command executable name or path
 * @param {string[]} [args] version arguments; defaults to `["--version"]`
 * @returns {string|undefined} first output line, or `undefined` when the command fails
 */
export function commandVersion(command, args = ["--version"]) {
  const result = run(command, args, { capture: true });
  return result.ok ? (result.stdout || result.stderr).trim().split("\n")[0] : undefined;
}

/**
 * Cargo executable, honoring `$CARGO`.
 * @returns {string} cargo executable name or path
 */
export function cargoPath() {
  return process.env.CARGO || "cargo";
}

/**
 * Rustc executable, honoring `$RUSTC`.
 * @returns {string} rustc executable name or path
 */
export function rustcPath() {
  return process.env.RUSTC || "rustc";
}

/**
 * Reads the Rust host target triple from `rustc -vV`.
 * @returns {string} host target triple
 * @throws {Error} when `rustc -vV` fails or reports no host triple
 */
export function hostTriple() {
  const result = run(rustcPath(), ["-vV"], { capture: true });
  if (!result.ok) {
    throw new Error(
      `Cannot run \`${rustcPath()} -vV\`. Install a Rust stable toolchain (rustup) to build the native addon.`
    );
  }
  const host = result.stdout.match(/^host:\s*(\S+)$/m);
  if (!host) throw new Error("Could not determine the Rust host triple from `rustc -vV`.");
  return host[1];
}

/**
 * Detects a musl Linux host.
 * @param {string} [platform] platform to inspect; defaults to `process.platform`
 * @returns {boolean} `true` when the runtime links against musl libc
 */
export function isMusl(platform = process.platform) {
  if (platform !== "linux") return false;
  try {
    if (readFileSync("/usr/bin/ldd", "utf8").includes("musl")) return true;
  } catch {
    // fall through to the runtime report
  }
  try {
    const report = process.report?.getReport?.();
    if (report?.header?.glibcVersionRuntime) return false;
    if (
      Array.isArray(report?.sharedObjects) &&
      report.sharedObjects.some((file) => file.includes("libc.musl-") || file.includes("ld-musl-"))
    ) {
      return true;
    }
  } catch {
    // unknown libc: assume glibc like the upstream NAPI loader
  }
  return false;
}

/**
 * NAPI-RS binary file name for a platform/architecture pair.
 * @param {string} [platform] target platform; defaults to `process.platform`
 * @param {string} [arch] target architecture; defaults to `process.arch`
 * @returns {string} NAPI-RS binary file name
 * @throws {Error} for unsupported platforms or architectures
 */
export function napiBinaryName(platform = process.platform, arch = process.arch) {
  if (platform === "darwin") {
    if (arch === "x64" || arch === "arm64") return `tray-icon-node.darwin-${arch}.node`;
    throw new Error(`Unsupported macOS architecture for the native addon: ${arch}`);
  }
  if (platform === "win32") {
    if (arch === "x64" || arch === "arm64" || arch === "ia32") {
      return `tray-icon-node.win32-${arch}-msvc.node`;
    }
    throw new Error(`Unsupported Windows architecture for the native addon: ${arch}`);
  }
  if (platform === "linux") {
    const suffix = isMusl(platform) ? "musl" : "gnu";
    if (arch === "x64" || arch === "arm64") return `tray-icon-node.linux-${arch}-${suffix}.node`;
    if (arch === "arm") return `tray-icon-node.linux-arm-${suffix}eabihf.node`;
    throw new Error(`Unsupported Linux architecture for the native addon: ${arch}`);
  }
  throw new Error(`The native addon is built for linux, darwin, and win32 only (got ${platform}).`);
}

/**
 * Cargo release artifact file name.
 * @param {string} [platform] target platform; defaults to `process.platform`
 * @returns {string} shared-library file name emitted by cargo
 */
export function platformArtifactName(platform = process.platform) {
  if (platform === "win32") return "tray_icon_node.dll";
  if (platform === "darwin") return "libtray_icon_node.dylib";
  return "libtray_icon_node.so";
}

/**
 * GTK/AppIndicator pkg-config modules missing on Linux.
 * @returns {string[]} missing pkg-config module names; empty off Linux
 */
export function missingLinuxNativeModules() {
  if (process.platform !== "linux") return [];
  const modules = ["gtk+-3.0", "ayatana-appindicator3-0.1", "glib-2.0", "x11"];
  return modules.filter(
    (module) => !run("pkg-config", ["--exists", module], { capture: true }).ok
  );
}

/**
 * Reads `build-manifest.json` when present and valid.
 * @param {string} [directory] native source directory; defaults to {@link NATIVE_DIR}
 * @returns {Object|undefined} parsed build manifest, or `undefined` when absent or malformed
 */
export function readBuildManifest(directory = NATIVE_DIR) {
  const target = join(directory, BUILD_MANIFEST);
  if (!existsSync(target)) return undefined;
  try {
    return JSON.parse(readFileSync(target, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Resolves the built binary named by the manifest.
 * @param {string} [directory] native source directory; defaults to {@link NATIVE_DIR}
 * @returns {string|undefined} absolute binary path when the manifest names an existing file
 */
export function binaryPath(directory = NATIVE_DIR) {
  const manifest = readBuildManifest(directory);
  if (!manifest?.binary) return undefined;
  const target = join(directory, manifest.binary);
  return existsSync(target) ? target : undefined;
}

/**
 * Builds the native addon from the verified source.
 * @param {Object} [options] native directory and logger
 * @param {string} [options.directory] native source directory; defaults to {@link NATIVE_DIR}
 * @param {function(string): void} [options.log] log sink; defaults to `console.log`
 * @returns {Object} the written build manifest
 * @throws {Error} when verification, cargo, or the platform toolchain is unavailable
 */
export function buildNative({ directory = NATIVE_DIR, log = console.log } = {}) {
  const { observed } = verifySourceTree(directory);
  const cargo = cargoPath();
  const version = commandVersion(cargo);
  if (!version) {
    throw new Error(
      "Cannot find `cargo`. Run `npm run for-os:init` or install Rust stable from https://rustup.rs."
    );
  }
  const rustcVersion = commandVersion(rustcPath(), ["--version"]);
  const triple = hostTriple();
  const architecture = napiBinaryName(process.platform, process.arch);
  const missingModules = missingLinuxNativeModules();
  if (missingModules.length) {
    throw new Error(
      "Missing Linux native development libraries (" +
        missingModules.join(", ") +
        "). On Ubuntu/Debian install: libgtk-3-dev libayatana-appindicator3-dev " +
        "libglib2.0-dev libxdo-dev libx11-dev libnotify-bin. Run `npm run for-os:init`."
    );
  }
  log(`for-os: building ${NATIVE_PACKAGE}@${NATIVE_VERSION} from native source (${triple})`);
  const args = ["build", "--release", "--locked", "--manifest-path", join(directory, "Cargo.toml")];
  const result = run(cargo, args);
  if (!result.ok) {
    throw new Error(
      `cargo build failed for the native addon (status ${result.status}). ` +
        "Install the platform GUI development libraries listed in native/tray-icon-node/UPSTREAM.md and retry."
    );
  }
  const artifact = join(directory, "target", "release", platformArtifactName());
  if (!existsSync(artifact)) {
    throw new Error(`cargo build succeeded but ${artifact} does not exist.`);
  }
  const destination = join(directory, architecture);
  copyFileSync(artifact, destination);
  const manifest = {
    version: 1,
    package: NATIVE_PACKAGE,
    packageVersion: NATIVE_VERSION,
    sourceDigest: observed.sourceDigest,
    target: triple,
    platform: process.platform,
    arch: process.arch,
    binary: architecture,
    sha512: sha512File(destination),
    builtAt: new Date().toISOString(),
    toolchain: { cargo: version, rustc: rustcVersion },
  };
  writeFileSync(join(directory, BUILD_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  log(`for-os: built ${architecture} (sha512 ${manifest.sha512})`);
  return manifest;
}

/**
 * Reuses a verified build, otherwise rebuilds (or degrades when not required).
 * @param {Object} [options] native directory, logger, and required-build flag
 * @param {string} [options.directory] native source directory; defaults to {@link NATIVE_DIR}
 * @param {function(string): void} [options.log] log sink; defaults to `console.log`
 * @param {boolean} [options.required] when `true`, rethrow build failures instead of degrading
 * @returns {Object|undefined} build manifest, or `undefined` when the build degraded
 */
export function ensureBuilt({ directory = NATIVE_DIR, log = console.log, required = false } = {}) {
  const { observed } = verifySourceTree(directory);
  const existing = readBuildManifest(directory);
  const existingBinary = binaryPath(directory);
  const architecture = napiBinaryName(process.platform, process.arch);
  if (
    existing &&
    existingBinary &&
    existing.sourceDigest === observed.sourceDigest &&
    existing.sha512 === sha512File(existingBinary) &&
    existing.binary === architecture
  ) {
    log(`for-os: reusing verified build ${existing.binary}`);
    return existing;
  }
  try {
    return buildNative({ directory, log });
  } catch (error) {
    if (required) throw error;
    log(
      `for-os: native build unavailable (${error instanceof Error ? error.message : String(error)}). ` +
        "The tray and notification bridges will report unavailable at runtime. " +
        "Run `npm run for-os:build` after installing the toolchain."
    );
    return undefined;
  }
}

/**
 * Materializes a verified package copy under `node_modules/tray-icon-node`.
 * @param {Object} [options] source directory, destination, logger, and required-build flag
 * @param {string} [options.directory] native source directory; defaults to {@link NATIVE_DIR}
 * @param {string} [options.destination] target package directory; defaults to the package `node_modules`
 * @param {function(string): void} [options.log] log sink; defaults to `console.log`
 * @param {boolean} [options.required] when `true`, fail instead of materializing without a binary
 * @returns {Object} `{ manifest, build, destination }` describing the materialized copy
 */
export function installNative({
  directory = NATIVE_DIR,
  destination = join(PACKAGE_ROOT, "node_modules", NATIVE_PACKAGE),
  log = console.log,
  required = false,
} = {}) {
  const { manifest } = verifySourceTree(directory);
  const build = ensureBuilt({ directory, log, required });

  const materialize = (targetDirectory) => {
    rmSync(targetDirectory, { recursive: true, force: true });
    mkdirSync(targetDirectory, { recursive: true });
    for (const relativePath of Object.keys(manifest.files)) {
      const source = join(directory, relativePath);
      const target = join(targetDirectory, relativePath);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target);
    }
    if (build) {
      copyFileSync(join(directory, BUILD_MANIFEST), join(targetDirectory, BUILD_MANIFEST));
      copyFileSync(join(directory, build.binary), join(targetDirectory, build.binary));
    }
  };

  materialize(destination);
  log(
    build
      ? `for-os: materialized verified ${NATIVE_PACKAGE}@${NATIVE_VERSION} at ${destination}`
      : `for-os: materialized ${NATIVE_PACKAGE}@${NATIVE_VERSION} without a native binary at ${destination}`
  );

  const initCwd = process.env.INIT_CWD;
  if (initCwd) {
    const projectDestination = join(resolve(initCwd), "node_modules", NATIVE_PACKAGE);
    if (resolve(projectDestination) !== resolve(destination)) {
      try {
        materialize(projectDestination);
        log(`for-os: also materialized the addon at ${projectDestination}`);
      } catch (error) {
        log(
          `for-os: could not materialize the addon at ${projectDestination} (${error instanceof Error ? error.message : String(error)}); ` +
            "set FOR_OS_NATIVE_MODULE to an explicit module path if runtime resolution fails."
        );
      }
    }
  }

  return { manifest, build, destination };
}

/**
 * Reports source/build state without building (used by `--check`).
 * @param {Object} [options] native directory and logger
 * @param {string} [options.directory] native source directory; defaults to {@link NATIVE_DIR}
 * @param {function(string): void} [options.log] log sink; defaults to `console.log`
 * @returns {Object} `{ manifest, observed, build }` without mutating the source tree
 */
export function inspectNative({ directory = NATIVE_DIR, log = console.log } = {}) {
  const { manifest, observed } = verifySourceTree(directory);
  const build = readBuildManifest(directory);
  const binary = binaryPath(directory);
  log(
    `for-os: native source verified (${Object.keys(observed.files).length} files, source digest ${observed.sourceDigest}).`
  );
  if (build && binary) {
    log(`for-os: build manifest present for ${build.binary} (${build.target}, sha512 ${build.sha512}).`);
  } else {
    log("for-os: no native binary in the source tree (run `npm run for-os:build`).");
  }
  return { manifest, observed, build };
}
