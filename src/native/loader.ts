/**
 * @module for-os.native.loader
 * @description Locates and loads the vendored `tray-icon-node` NAPI-RS addon.
 * @summary The addon is built from `native/tray-icon-node` by
 * `scripts/for-os-install.mjs` and materialized into `node_modules/tray-icon-node`.
 * Resolution order is an explicit `FOR_OS_NATIVE_MODULE` path, normal Node
 * package resolution from the current project, then the crate's checked-in
 * `index.js` under the current project. Loading never throws: callers decide
 * whether a missing addon is fatal.
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { NativeModuleUnavailableError } from "../errors";
import type { NativeModule } from "./types";

/** Environment variable that pins an explicit native addon module path. */
export const NATIVE_MODULE_ENV = "FOR_OS_NATIVE_MODULE";

/** Package name of the vendored addon. */
export const NATIVE_MODULE_PACKAGE = "tray-icon-node";

/** A successful or failed native-module load. */
export type NativeLoadResult =
  | { available: true; api: NativeModule; modulePath: string }
  | { available: false; error: Error };

const REQUIRED_MEMBERS = [
  "initialize",
  "update",
  "Icon",
  "Menu",
  "TrayIconBuilder",
  "pollMenuEvents",
  "showNotification",
] as const;

let cached: NativeLoadResult | undefined;

function requireFrom(directory: string): NodeRequire {
  return createRequire(join(directory, "package.json"));
}

function resolutionRoots(): string[] {
  const roots = new Set<string>([process.cwd()]);
  const initCwd = process.env.INIT_CWD;
  if (initCwd) roots.add(resolve(initCwd));
  const entry = process.argv[1];
  if (entry) roots.add(dirname(resolve(entry)));
  return [...roots];
}

function candidatePaths(): string[] {
  const candidates: string[] = [];
  const explicit = process.env[NATIVE_MODULE_ENV];
  if (explicit) candidates.push(resolve(explicit));
  for (const root of resolutionRoots()) {
    try {
      candidates.push(requireFrom(root).resolve(NATIVE_MODULE_PACKAGE));
    } catch {
      // not installed under this resolution root: try the source tree below
    }
    candidates.push(join(root, "native", NATIVE_MODULE_PACKAGE, "index.js"));
    candidates.push(join(root, "node_modules", NATIVE_MODULE_PACKAGE, "index.js"));
  }
  return [...new Set(candidates)];
}

function isNativeModule(candidate: unknown): candidate is NativeModule {
  if (!candidate || typeof candidate !== "object") return false;
  const record = candidate as Record<string, unknown>;
  return REQUIRED_MEMBERS.every((member) => typeof record[member] === "function");
}

/**
 * Loads the native addon, reusing one process-wide result.
 * @return {NativeLoadResult} the loaded module or the reason it is unavailable
 */
export function loadNativeModule(): NativeLoadResult {
  if (cached) return cached;
  const tried = candidatePaths();
  const failures: string[] = [];
  for (const candidate of tried) {
    if (!existsSync(candidate)) {
      failures.push(`${candidate} (missing)`);
      continue;
    }
    try {
      const loaded = requireFrom(dirname(candidate))(candidate) as { default?: unknown };
      const api = (loaded?.default ?? loaded) as unknown;
      if (!isNativeModule(api)) {
        failures.push(`${candidate} (unexpected module shape)`);
        continue;
      }
      cached = { available: true, api, modulePath: candidate };
      return cached;
    } catch (error) {
      failures.push(
        `${candidate} (${error instanceof Error ? error.message : String(error)})`
      );
    }
  }
  cached = {
    available: false,
    error: new NativeModuleUnavailableError(
      `The native for-os addon "${NATIVE_MODULE_PACKAGE}" is not available. ` +
        `Run "npm run for-os:install" to build it from native/${NATIVE_MODULE_PACKAGE}. ` +
        `Tried: ${failures.join("; ")}`
    ),
  };
  return cached;
}

/**
 * Loads the native addon or throws {@link NativeModuleUnavailableError}.
 * @return {NativeModule} the loaded native module
 * @throws {NativeModuleUnavailableError} when no usable addon was found
 */
export function requireNativeModule(): NativeModule {
  const result = loadNativeModule();
  if (!result.available) throw result.error;
  return result.api;
}

/** Clears the process-wide load cache (used by tests and re-installs). */
export function resetNativeModuleCache(): void {
  cached = undefined;
}
