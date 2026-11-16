import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NativeModuleUnavailableError } from "../../src/errors";
import {
  loadNativeModule,
  NATIVE_MODULE_ENV,
  NATIVE_MODULE_PACKAGE,
  requireNativeModule,
  resetNativeModuleCache,
} from "../../src/native/loader";

const API_BODY = `
function Icon() {}
Icon.fromPath = function (path) { return { path: path }; };
Icon.fromRgba = function (rgba, width, height) {
  return { rgba: rgba, width: width, height: height };
};
function noop() {}
const api = {
  initialize: noop,
  update: noop,
  Icon: Icon,
  Menu: class {},
  MenuItemBuilder: class {},
  TrayIconBuilder: class {},
  pollMenuEvents: function () { return null; },
  showNotification: noop,
};
`;

const VALID_MODULE = `${API_BODY}\nmodule.exports = api;\n`;
const DEFAULT_EXPORT_MODULE = `${API_BODY}\nmodule.exports = { default: api };\n`;

describe("native module loader", () => {
  let workspace: string;
  let originalModule: string | undefined;
  let originalInitCwd: string | undefined;

  function writeFile(name: string, contents: string): string {
    const file = join(workspace, name);
    writeFileSync(file, contents);
    return file;
  }

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "for-os-loader-test-"));
    originalModule = process.env[NATIVE_MODULE_ENV];
    originalInitCwd = process.env.INIT_CWD;
    delete process.env[NATIVE_MODULE_ENV];
    delete process.env.INIT_CWD;
    resetNativeModuleCache();
  });

  afterEach(() => {
    resetNativeModuleCache();
    if (originalModule === undefined) delete process.env[NATIVE_MODULE_ENV];
    else process.env[NATIVE_MODULE_ENV] = originalModule;
    if (originalInitCwd === undefined) delete process.env.INIT_CWD;
    else process.env.INIT_CWD = originalInitCwd;
    rmSync(workspace, { recursive: true, force: true });
  });

  it("defines the documented environment variable and package name", () => {
    expect(NATIVE_MODULE_ENV).toBe("FOR_OS_NATIVE_MODULE");
    expect(NATIVE_MODULE_PACKAGE).toBe("tray-icon-node");
  });

  it("loads an explicit addon once, caches it, and returns it from requireNativeModule", () => {
    const addon = writeFile("addon.cjs", VALID_MODULE);
    process.env[NATIVE_MODULE_ENV] = addon;

    const first = loadNativeModule();
    expect(first.available).toBe(true);
    if (!first.available) return;
    expect(first.modulePath).toBe(resolve(addon));
    expect(typeof first.api.initialize).toBe("function");
    expect(loadNativeModule()).toBe(first);
    expect(requireNativeModule()).toBe(first.api);
  });

  it("accepts an addon exposed through a default export", () => {
    const addon = writeFile("default-addon.cjs", DEFAULT_EXPORT_MODULE);
    process.env[NATIVE_MODULE_ENV] = addon;

    const result = loadNativeModule();
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.modulePath).toBe(resolve(addon));
    expect(typeof result.api.update).toBe("function");
  });

  it("skips a loaded module with the wrong shape and explains why it is unavailable", () => {
    const addon = writeFile("bad-shape.cjs", "module.exports = { initialize: function () {} };\n");
    process.env[NATIVE_MODULE_ENV] = addon;

    const result = loadNativeModule();
    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.error).toBeInstanceOf(NativeModuleUnavailableError);
    expect(result.error.message).toContain("unexpected module shape");
    expect(result.error.message).toContain(addon);
    expect(result.error.message).toContain("npm run for-os:install");
    expect(loadNativeModule()).toBe(result);
    expect(() => requireNativeModule()).toThrow(NativeModuleUnavailableError);
  });

  it("treats a non-object module export as the wrong shape", () => {
    const addon = writeFile("primitive.cjs", "module.exports = 42;\n");
    process.env[NATIVE_MODULE_ENV] = addon;

    const result = loadNativeModule();
    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.error.message).toContain("unexpected module shape");
  });

  it("records a thrown module error without aborting the search", () => {
    const addon = writeFile("throws.cjs", 'throw new Error("fixture boom");\n');
    process.env[NATIVE_MODULE_ENV] = addon;

    const result = loadNativeModule();
    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.error.message).toContain("fixture boom");
  });

  it("stringifies non-Error module throws", () => {
    const addon = writeFile("throws-string.cjs", 'throw "string boom";\n');
    process.env[NATIVE_MODULE_ENV] = addon;

    const result = loadNativeModule();
    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.error.message).toContain("string boom");
  });

  it("resolves the addon from an INIT_CWD node_modules tree", () => {
    const packageDirectory = join(workspace, "node_modules", NATIVE_MODULE_PACKAGE);
    mkdirSync(packageDirectory, { recursive: true });
    writeFileSync(
      join(packageDirectory, "package.json"),
      JSON.stringify({ name: NATIVE_MODULE_PACKAGE, main: "index.cjs" })
    );
    const addon = join(packageDirectory, "index.cjs");
    writeFileSync(addon, VALID_MODULE);
    process.env.INIT_CWD = workspace;

    const result = loadNativeModule();
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.modulePath).toBe(addon);
  });
});
