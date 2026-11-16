#!/usr/bin/env node
/**
 * Initializes everything needed to build the native tray/notification addon.
 *
 * Checks the Node version, Rust stable (rustup), the platform native build
 * dependencies, and the notification service, installs what is missing when it
 * is allowed to, then builds and materializes the addon. Installation is
 * explicit: use `--install` (the default) on a development machine and
 * `--check` in CI to report readiness without mutating the host.
 * @module scripts/for-os-init
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  commandVersion,
  installNative,
  missingLinuxNativeModules,
  run,
} from "./lib/native.mjs";

const process = globalThis.process;

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

function rustReady() {
  ensurePath();
  const cargo = commandVersion("cargo");
  const rustc = commandVersion("rustc");
  if (cargo && rustc) {
    log(`Rust ready: ${cargo}; ${rustc}`);
    return true;
  }
  log("Rust toolchain is missing.");
  return false;
}

function installRust() {
  if (rustReady()) return true;
  log("Installing Rust stable with rustup...");
  const installer = spawnSync(
    "sh",
    ["-c", "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y"],
    { stdio: "inherit" }
  );
  if (installer.status !== 0) {
    log("rustup installation failed. Install Rust manually from https://rustup.rs and retry.");
    return false;
  }
  ensurePath();
  if (rustReady()) return true;
  const toolchain = run("rustup", ["toolchain", "install", "stable"]);
  run("rustup", ["default", "stable"]);
  return toolchain.ok && rustReady();
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
