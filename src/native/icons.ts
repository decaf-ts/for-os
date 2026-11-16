/**
 * @module for-os.native.icons
 * @description Converts TypeScript icon sources into native tray icon handles.
 * @summary The native addon loads icons from file paths (or raw RGBA), so
 * base64 and byte-buffer sources are materialized into a private temporary
 * directory that is removed when the owning tray closes.
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, sep } from "node:path";
import { IconError } from "../errors";
import type { NativeIconFactory } from "./types";

const MAX_ICON_EXTENSION_LENGTH = 16;

function sanitizeExtension(extension: string): string {
  const cleaned = extension
    .replace(/[^A-Za-z0-9.]/g, "")
    .replace(/\.{2,}/g, ".")
    .slice(0, MAX_ICON_EXTENSION_LENGTH)
    .replace(/^\.+/, "");
  return cleaned ? `.${cleaned}` : ".png";
}

/** Raw RGBA pixels accepted by {@link IconSource}. */
export type RgbaIcon = {
  rgba: Buffer | Uint8Array;
  width: number;
  height: number;
};

/**
 * Any icon representation accepted by {@link IconResolver.resolve}.
 * - `string`: absolute or relative image file path
 * - `{ path }`: image file path
 * - `{ base64 }`: base64-encoded image bytes (PNG/JPEG, decided by `extension`)
 * - `{ png }` / `{ bytes }`: raw encoded image bytes
 * - `{ rgba, width, height }`: uncompressed RGBA pixels
 *
 * Caller-supplied `extension` values are sanitized to a safe alphanumeric/dot
 * file suffix (capped at 16 characters) and fall back to `.png`.
 */
export type IconSource =
  | string
  | { path: string }
  | { base64: string; extension?: string }
  | { png: Buffer | Uint8Array }
  | { bytes: Buffer | Uint8Array; extension?: string }
  | RgbaIcon;

function hasRgba(value: unknown): value is RgbaIcon {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RgbaIcon>;
  return (
    (Buffer.isBuffer(candidate.rgba) || candidate.rgba instanceof Uint8Array) &&
    typeof candidate.width === "number" &&
    typeof candidate.height === "number"
  );
}

/**
 * @description Owns the temporary directory used to materialize file-backed icons.
 * @summary One resolver is normally owned by a tray or notification host and
 * disposed with it. Resolving an already-native handle is intentionally not
 * supported; callers pass a source and the resolver keeps the native object.
 * @param {NativeIconFactory} api native icon factory used to build handles
 * @param {function(string): string} [createDirectory] creates the private
 * temporary directory; defaults to `fs.mkdtempSync` under the OS temp dir
 * @param {function(string): void} [removeDirectory] removes the private
 * directory on {@link IconResolver.dispose}; defaults to a recursive `fs.rmSync`
 * @class IconResolver
 */
export class IconResolver {
  private directory?: string;

  constructor(
    private readonly api: NativeIconFactory,
    private readonly createDirectory: (prefix: string) => string = (prefix) =>
      mkdtempSync(join(tmpdir(), prefix)),
    private readonly removeDirectory: (directory: string) => void = (directory) =>
      rmSync(directory, { recursive: true, force: true })
  ) {}

  private ensureDirectory(): string {
    if (!this.directory) this.directory = this.createDirectory("for-os-icons-");
    return this.directory;
  }

  /**
   * Materializes `source` into a native icon handle.
   * @param {IconSource} source the icon path, bytes, base64, or RGBA data
   * @return {unknown} the native icon handle expected by the addon
   * @throws {IconError} when the source is invalid or points to a missing file
   */
  resolve(source: IconSource): unknown {
    if (typeof source === "string") return this.fromPath(source);
    if (!source || typeof source !== "object") {
      throw new IconError("Icon source must be a path, bytes, base64 string, or RGBA data.");
    }
    if (hasRgba(source)) {
      const expected = source.width * source.height * 4;
      if (source.rgba.length !== expected) {
        throw new IconError(
          `RGBA icon length ${source.rgba.length} does not match ${source.width}x${source.height}x4 (${expected}).`
        );
      }
      return this.api.fromRgba(Buffer.from(source.rgba), source.width, source.height);
    }
    if ("path" in source) return this.fromPath(source.path);
    if ("base64" in source) {
      const bytes = Buffer.from(source.base64, "base64");
      if (!bytes.length) throw new IconError("Icon base64 payload is empty or invalid.");
      return this.fromBytes(bytes, source.extension ?? ".png");
    }
    if ("png" in source) return this.fromBytes(source.png, ".png");
    if ("bytes" in source) return this.fromBytes(source.bytes, source.extension ?? ".png");
    throw new IconError("Unsupported icon source shape.");
  }

  private fromPath(path: string): unknown {
    if (!path) throw new IconError("Icon path is empty.");
    if (!existsSync(path)) throw new IconError(`Icon file does not exist: ${path}`);
    return this.api.fromPath(path);
  }

  private fromBytes(bytes: Buffer | Uint8Array, extension: string): unknown {
    const directory = this.ensureDirectory();
    const file = join(
      directory,
      `icon-${Date.now()}-${Math.random().toString(16).slice(2)}${sanitizeExtension(extension)}`
    );
    if (!file.startsWith(directory + sep)) {
      throw new IconError("Icon extension resolved outside the icon directory.");
    }
    writeFileSync(file, Buffer.from(bytes));
    return this.api.fromPath(file);
  }

  /** Removes every materialized icon file; idempotent. */
  dispose(): void {
    if (!this.directory) return;
    this.removeDirectory(this.directory);
    this.directory = undefined;
  }

  /** Directory holding materialized icons, when one has been created. */
  get iconDirectory(): string | undefined {
    return this.directory;
  }
}

/** Returns a stable file extension for a path, defaulting to `.png`. */
export function iconExtension(path: string): string {
  return extname(path) || ".png";
}
