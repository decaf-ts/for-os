#!/usr/bin/env node
/**
 * Initializes everything needed to build the native tray/notification addon.
 *
 * Checks the Node version, the pinned Rust toolchain (rustup), the platform
 * native build dependencies, and the notification service, installs what is
 * missing when it is allowed to, then builds and materializes the addon.
 * Installation is explicit: use `--install` (the default) on a development
 * machine and `--check` in CI to report readiness without mutating the host.
 *
 * Rust is pinned so local and CI builds stay reproducible instead of silently
 * tracking whatever `stable` happens to be that day:
 *
 * - Toolchain {@link RUST_TOOLCHAIN} (`1.100.0`) is the current stable release
 *   (2026-11-12) and is the only version `--check`/`--install` consider ready.
 * - Bootstrap uses rustup-init {@link RUSTUP_INIT_VERSION} (`1.29.3`), downloaded
 *   from the versioned archive and verified against a hard-coded SHA-256 before
 *   execution. The installer is never piped from the network into a shell.
 * - The SHA-256 values come from the official rustup archive checksum files:
 *   `https://static.rust-lang.org/rustup/archive/1.29.3/<target>/rustup-init.sha256`
 *   (Unix) and `.../<target>/rustup-init.exe.sha256` (Windows).
 * @module scripts/for-os-init
 */
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  commandVersion,
  installNative,
  missingLinuxNativeModules,
  run,
} from "./lib/native.mjs";

const process = globalThis.process;

/** Pinned stable Rust toolchain used for every native addon build. */
const RUST_TOOLCHAIN = "1.100.0";

/** Pinned rustup-init release used to bootstrap a fresh machine. */
const RUSTUP_INIT_VERSION = "1.29.3";

/** Base URL of the versioned rustup-init archive. */
const RUSTUP_INIT_ARCHIVE = `https://static.rust-lang.org/rustup/archive/${RUSTUP_INIT_VERSION}`;

/**
 * rustup-init artifacts pinned per Node `platform-arch`, with the SHA-256 taken
 * from the matching official `rustup-init*.sha256` file in the archive.
 */
const RUSTUP_INIT_PINS = {
  "linux-x64": {
    triple: "x86_64-unknown-linux-gnu",
    binary: "rustup-init",
    sha256: "b1c8cb14e30889e7e2999e6b69e62d9e9b9ffc0f4df8180564d306d9680e6c55",
  },
  "linux-arm64": {
    triple: "aarch64-unknown-linux-gnu",
    binary: "rustup-init",
    sha256: "9f608c142e0e38a78957d0661ba1dfaf0b6fb37184cfaa4b9a0aa57af6184282",
  },
  "darwin-x64": {
    triple: "x86_64-apple-darwin",
    binary: "rustup-init",
    sha256: "bc107f1fb0228de7fa32413c89c1b305cea9cd256e94b01150cd054128145429",
  },
  "darwin-arm64": {
    triple: "aarch64-apple-darwin",
    binary: "rustup-init",
    sha256: "63752a1919a3a4793173ec70f8f212621a7ce38ba6a246095984482f4de20f9f",
  },
  "win32-x64": {
    triple: "x86_64-pc-windows-msvc",
    binary: "rustup-init.exe",
    sha256: "38027d51d69a5d05493627a0634dbea52d6cd793c8f072d2373d3f4163eec7db",
  },
  "win32-ia32": {
    triple: "i686-pc-windows-msvc",
    binary: "rustup-init.exe",
    sha256: "fa448cc3839d6fbacb5ed1954c16f60c4d16e7e6476677a66fffb34dc91bd201",
  },
};

const HELP = `Usage: node scripts/for-os-init.mjs [--check] [--skip-build]

Installs the Rust toolchain and native build dependencies required by
native/tray-icon-node, then builds and materializes the addon.

  --check       report readiness without installing anything
  --skip-build  install dependencies but do not build the addon
  --help        show this help

Linux packages (Ubuntu/Debian): build-essential pkg-config libgtk-3-dev
libayatana-appindicator3-dev libglib2.0-dev libxdo-dev libx11-dev libnotify-bin`;

const LINUX_PACKAGES = [
  "build-essential",
  "pkg-config",
  "libgtk-3-dev",
  "libayatana-appindicator3-dev",
  "libglib2.0-dev",
  "libxdo-dev",
  "libx11-dev",
  "libnotify-bin",
];

function log(message) {
  console.log(`for-os-init: ${message}`);
}

function ensurePath() {
  const cargoBin = join(homedir(), ".cargo", "bin");
  if (existsSync(cargoBin) && !process.env.PATH.split(":").includes(cargoBin)) {
    process.env.PATH = `${cargoBin}:${process.env.PATH}`;
  }
}

function nodeReady() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 20) return true;
  log(`Node ${process.versions.node} is too old; @decaf-ts/for-os requires Node >= 20.`);
  return false;
}

function installedRustVersion() {
  const rustc = commandVersion("rustc");
  if (!rustc) return undefined;
  const match = rustc.match(/rustc\s+(\d+\.\d+\.\d+)/);
  return match ? match[1] : undefined;
}

function rustReady() {
  ensurePath();
  const cargo = commandVersion("cargo");
  const rustc = commandVersion("rustc");
  if (!cargo || !rustc) {
    log("Rust toolchain is missing.");
    return false;
  }
  const version = installedRustVersion();
  if (version !== RUST_TOOLCHAIN) {
    log(
      `Rust ${version || "unknown"} is installed, but for-os builds are pinned to ${RUST_TOOLCHAIN}.`
    );
    return false;
  }
  log(`Rust ready: ${cargo}; ${rustc}`);
  return true;
}

function rustupInitPin() {
  return RUSTUP_INIT_PINS[`${process.platform}-${process.arch}`];
}

function downloadRustupInit(pin, destination) {
  const url = `${RUSTUP_INIT_ARCHIVE}/${pin.triple}/${pin.binary}`;
  log(`Downloading rustup-init ${RUSTUP_INIT_VERSION} for ${pin.triple}...`);
  const download = spawnSync(
    "curl",
    ["--proto", "=https", "--tlsv1.2", "-sSfL", "-o", destination, url],
    { stdio: "inherit" }
  );
  return download.status === 0;
}

function verifyRustupInit(file, expected) {
  const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
  if (actual !== expected) {
    log(`rustup-init checksum mismatch: expected ${expected}, got ${actual}.`);
    return false;
  }
  log(`rustup-init sha256 verified: ${expected}`);
  return true;
}

function bootstrapRustup() {
  const pin = rustupInitPin();
  if (!pin) {
    log(
      `No pinned rustup-init is available for ${process.platform}-${process.arch}. ` +
        "Install Rust manually from https://rustup.rs and retry."
    );
    return false;
  }
  const dir = mkdtempSync(join(tmpdir(), "for-os-rustup-"));
  const installer = join(dir, pin.binary);
  try {
    if (!downloadRustupInit(pin, installer)) {
      log("rustup-init download failed. Install Rust manually from https://rustup.rs and retry.");
      return false;
    }
    if (!verifyRustupInit(installer, pin.sha256)) {
      log("Refusing to run an unverified rustup-init; install Rust manually from https://rustup.rs.");
      return false;
    }
    if (process.platform !== "win32") chmodSync(installer, 0o755);
    const result = spawnSync(
      installer,
      ["-y", "--default-toolchain", RUST_TOOLCHAIN],
      { stdio: "inherit" }
    );
    if (result.status !== 0) {
      log("rustup-init failed. Install Rust manually from https://rustup.rs and retry.");
      return false;
    }
    return true;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function installRust() {
  ensurePath();
  if (rustReady()) return true;

  const hadRustup = Boolean(commandVersion("rustup"));
  if (!hadRustup) {
    if (!bootstrapRustup()) return false;
    ensurePath();
    if (rustReady()) return true;
  }

  log(`Ensuring pinned Rust toolchain ${RUST_TOOLCHAIN}...`);
  const toolchain = run("rustup", ["toolchain", "install", RUST_TOOLCHAIN]);
  if (!toolchain.ok) return false;
  const setDefault = run("rustup", ["default", RUST_TOOLCHAIN]);
  return setDefault.ok && rustReady();
}

function linuxPackagesReady() {
  const missing = missingLinuxNativeModules();
  if (!missing.length) {
    log("Linux tray development libraries ready.");
    return true;
  }
  log(`Missing Linux development modules: ${missing.join(", ")}`);
  return false;
}

function installLinuxPackages() {
  if (process.platform !== "linux") return true;
  if (linuxPackagesReady()) return true;
  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
  if (!isRoot && !run("sudo", ["-n", "true"], { capture: true }).ok) {
    log(
      "Native development libraries are missing and passwordless sudo is unavailable. " +
        `Install them as root, then rerun: apt-get update && apt-get install -y ${LINUX_PACKAGES.join(" ")}`
    );
    return false;
  }
  log("Installing Linux native development libraries...");
  const runner = isRoot ? "apt-get" : "sudo";
  const updateArgs = isRoot ? ["update"] : ["apt-get", "update"];
  const installArgs = isRoot
    ? ["install", "-y", ...LINUX_PACKAGES]
    : ["apt-get", "install", "-y", ...LINUX_PACKAGES];
  const update = run(runner, updateArgs);
  if (!update.ok) {
    log("apt-get update failed.");
    return false;
  }
  const install = spawnSync(runner, installArgs, { stdio: "inherit" });
  if (install.status !== 0) {
    log("Native package installation failed.");
    return false;
  }
  return linuxPackagesReady();
}

function notifyServiceReady() {
  if (process.platform !== "linux") {
    log(`Notification service: using the native ${process.platform} backend.`);
    return true;
  }
  const hasNotifySend = Boolean(commandVersion("notify-send", ["--version"]));
  log(hasNotifySend ? "notify-send available." : "notify-send missing (install libnotify-bin).");
  return hasNotifySend;
}

function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return 0;
  }
  const unknown = argv.filter(
    (argument) => !["--check", "--install", "--skip-build"].includes(argument)
  );
  if (unknown.length) {
    console.error(`Unknown argument "${unknown[0]}".\n\n${HELP}`);
    return 2;
  }
  const checkOnly = argv.includes("--check");
  const skipBuild = argv.includes("--skip-build");

  let ready = nodeReady();
  ready = (checkOnly ? rustReady() : installRust()) && ready;
  ready = (checkOnly ? linuxPackagesReady() : installLinuxPackages()) && ready;
  ready = notifyServiceReady() && ready;

  if (!ready) {
    log(
      checkOnly
        ? "Host is not ready to build the native addon. Rerun without --check to install dependencies."
        : "Dependencies are incomplete; see the messages above."
    );
    return 1;
  }
  if (checkOnly) {
    log("Host is ready to build the native addon.");
    return 0;
  }
  if (skipBuild) {
    log("Dependencies installed; skipping the native build (--skip-build).");
    return 0;
  }
  installNative({ required: true });
  log("Native addon built and materialized. Tray and notification bridges are ready.");
  return 0;
}

process.exitCode = main(process.argv.slice(2));
