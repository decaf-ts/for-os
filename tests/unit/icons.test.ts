import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { IconError } from "../../src/errors";
import { IconResolver, iconExtension, type IconSource } from "../../src/native/icons";
import { TRAY_ICON_BASE64 } from "../../src/tray/assets";
import { createFakeNative } from "../fake-native";

function newResolver(): IconResolver {
  return new IconResolver(createFakeNative().Icon);
}

describe("IconResolver", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "for-os-icons-test-"));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it("resolves existing path sources and rejects empty, missing, or unsupported ones", () => {
    const resolver = newResolver();
    const iconPath = join(workspace, "idle.png");
    writeFileSync(iconPath, Buffer.from("png"));
    try {
      expect(resolver.resolve(iconPath)).toEqual({ path: iconPath });
      expect(resolver.resolve({ path: iconPath })).toEqual({ path: iconPath });
      expect(() => resolver.resolve("")).toThrow(IconError);
      expect(() => resolver.resolve("")).toThrow(/Icon path is empty/);
      expect(() => resolver.resolve(join(workspace, "missing.png"))).toThrow(/does not exist/);
      expect(() => resolver.resolve(42 as unknown as IconSource)).toThrow(/must be a path/);
      expect(() => resolver.resolve(null as unknown as IconSource)).toThrow(/must be a path/);
      expect(() => resolver.resolve({} as IconSource)).toThrow(/Unsupported icon source shape/);
    } finally {
      resolver.dispose();
    }
  });

  it("materializes base64, png, and byte sources into one temp directory and removes it on dispose", () => {
    const resolver = newResolver();
    let directory: string | undefined;
    try {
      expect(resolver.iconDirectory).toBeUndefined();

      const fromBase64 = resolver.resolve({ base64: TRAY_ICON_BASE64.idle }) as { path: string };
      directory = resolver.iconDirectory;
      expect(directory).toBeDefined();
      expect(fromBase64.path.startsWith(directory as string)).toBe(true);
      expect(existsSync(fromBase64.path)).toBe(true);

      const fromPng = resolver.resolve({ png: Buffer.from("png") }) as { path: string };
      const fromBytes = resolver.resolve({
        bytes: Buffer.from("jpg"),
        extension: "jpeg",
      }) as { path: string };
      expect(resolver.iconDirectory).toBe(directory);
      expect(fromPng.path.endsWith(".png")).toBe(true);
      expect(fromBytes.path.endsWith(".jpeg")).toBe(true);
      expect(existsSync(fromPng.path)).toBe(true);
      expect(existsSync(fromBytes.path)).toBe(true);

      expect(() => resolver.resolve({ base64: "" })).toThrow(/empty or invalid/);
    } finally {
      resolver.dispose();
      expect(resolver.iconDirectory).toBeUndefined();
      if (directory) expect(existsSync(directory)).toBe(false);
      expect(() => resolver.dispose()).not.toThrow();
    }
  });

  it("keeps traversal-style extensions inside the materialized icon directory", () => {
    const resolver = newResolver();
    try {
      const fromRelative = resolver.resolve({
        bytes: Buffer.from("evil"),
        extension: "../evil",
      }) as { path: string };
      const directory = resolver.iconDirectory as string;
      expect(directory).toBeDefined();
      expect(dirname(fromRelative.path)).toBe(directory);

      const poc = resolver.resolve({
        bytes: Buffer.from("evil"),
        extension: "x/../../.config/autostart/pwn.desktop",
      }) as { path: string };
      expect(resolver.iconDirectory).toBe(directory);
      expect(dirname(poc.path)).toBe(directory);
      expect(basename(poc.path)).not.toContain("..");
      expect(existsSync(poc.path)).toBe(true);
    } finally {
      resolver.dispose();
    }
  });

  it("validates RGBA byte lengths before handing pixels to the native factory", () => {
    const resolver = newResolver();
    try {
      expect(resolver.resolve({ rgba: Buffer.from([1, 2, 3, 4]), width: 1, height: 1 })).toMatchObject(
        { width: 1, height: 1 }
      );
      expect(() => resolver.resolve({ rgba: Buffer.alloc(3), width: 1, height: 1 })).toThrow(
        /does not match/
      );
    } finally {
      resolver.dispose();
    }
  });
});

describe("iconExtension", () => {
  it("keeps explicit extensions and defaults to png", () => {
    expect(iconExtension("/tmp/icon.PNG")).toBe(".PNG");
    expect(iconExtension("/tmp/icon")).toBe(".png");
  });
});
