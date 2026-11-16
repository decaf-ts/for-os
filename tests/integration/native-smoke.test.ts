import { NotificationCenter } from "../../src/notifications/NotificationCenter";
import { loadNativeModule, requireNativeModule } from "../../src/native/loader";
import { TRAY_ICON_BASE64 } from "../../src/tray/assets";
import { TrayIcon } from "../../src/tray/TrayIcon";

const native = loadNativeModule();
const enabled = process.env.FOR_OS_SMOKE === "1" && Boolean(process.env.DISPLAY);
const smoke = enabled ? it : it.skip;

describe("native addon integration", () => {
  it("reports why the addon is unavailable when it has not been built", () => {
    if (native.available) {
      expect(native.modulePath).toBeTruthy();
    } else {
      expect(native.error.message).toContain("tray-icon-node");
    }
  });

  smoke("creates a tray, switches icons at runtime, sends a timed notification, and closes", () => {
    const tray = TrayIcon.create({
      icon: { base64: TRAY_ICON_BASE64.idle },
      tooltip: "for-os native smoke test",
      menu: [{ id: "quit", label: "Quit" }],
    });
    const center = new NotificationCenter({ api: requireNativeModule() });
    try {
      expect(tray.active).toBe(true);
      expect(tray.setIcon({ base64: TRAY_ICON_BASE64.active })).toBe(true);
      tray.setTooltip("for-os native smoke test: active");
      tray.setIcon({ base64: TRAY_ICON_BASE64.idle });

      const notification = center.notify({
        title: "for-os smoke test",
        body: "Native notification with a 2 second timer.",
        timeoutMs: 2_000,
      });
      expect(notification.delivered).toBe(true);
    } finally {
      center.close();
      tray.close();
    }
    expect(tray.active).toBe(false);
  });
});
