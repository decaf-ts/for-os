import * as forOs from "../../src/index";
import { VERSION } from "../../src/index";

const PUBLIC_EXPORTS = [
  "NativeModuleUnavailableError",
  "TrayError",
  "NotificationError",
  "IconError",
  "IconResolver",
  "iconExtension",
  "NATIVE_MODULE_ENV",
  "NATIVE_MODULE_PACKAGE",
  "loadNativeModule",
  "requireNativeModule",
  "resetNativeModuleCache",
  "TRAY_ICON_BASE64",
  "trayIconPng",
  "TrayIcon",
  "DEFAULT_NOTIFICATION_TIMEOUT_MS",
  "NotificationCenter",
  "notify",
];

describe("for-os public barrel", () => {
  it("re-exports the bridge surface and reports a build version", () => {
    for (const name of PUBLIC_EXPORTS) {
      expect(forOs).toHaveProperty(name);
    }
    expect(typeof VERSION).toBe("string");
    expect(VERSION.length).toBeGreaterThan(0);
  });

  it("exposes a decoded embedded tray icon through the barrel", () => {
    expect(forOs.trayIconPng("idle")).toBeInstanceOf(Buffer);
    expect(forOs.trayIconPng("idle").length).toBeGreaterThan(0);
  });
});
