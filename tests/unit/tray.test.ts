import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TrayError } from "../../src/errors";
import type {
  NativeCheckMenuItemHandle,
  NativeMenuItemHandle,
  NativeModule,
  NativeTrayEvent,
  NativeTrayHost,
} from "../../src/native/types";
import { TRAY_ICON_BASE64 } from "../../src/tray/assets";
import { TrayIcon } from "../../src/tray/TrayIcon";
import { createFakeNative, type FakeNative } from "../fake-native";

const ICON = { base64: TRAY_ICON_BASE64.idle } as const;

function createTray(api: FakeNative, log?: (message: string) => void): TrayIcon {
  return TrayIcon.create({ icon: { ...ICON }, log }, api);
}

describe("TrayIcon", () => {
  it("creates a native tray with a menu and dispatches menu actions to JavaScript", () => {
    const api = createFakeNative();
    const actions: string[] = [];
    const tray = TrayIcon.create(
      {
        icon: { base64: TRAY_ICON_BASE64.idle },
        tooltip: "for-os test",
        menu: [
          { id: "search", label: "Search now" },
          { id: "accept", label: "Accept", checkable: true },
          { separator: true, id: "sep", label: "" },
          { id: "quit", label: "Quit", onClick: (id) => actions.push(`item:${id}`) },
        ],
      },
      api
    );

    expect(api.calls.initialized).toBe(1);
    expect(api.calls.menuItems.map((item) => item.label)).toEqual([
      "Search now",
      "Accept",
      "Quit",
    ]);
    tray.on("search", (id) => actions.push(id));

    api.queueMenuEvent("search");
    api.queueMenuEvent("quit");
    expect(tray.poll()).toEqual(["search", "quit"]);
    expect(actions).toEqual(["search", "item:quit"]);

    tray.close();
    expect(api.calls.visibility).toContain(false);
    expect(tray.active).toBe(false);
  });

  it("switches the tray icon at runtime from base64, path, and RGBA sources", () => {
    const workspace = mkdtempSync(join(tmpdir(), "for-os-tray-icon-"));
    const iconPath = join(workspace, "active.png");
    writeFileSync(iconPath, Buffer.from("png"));
    const api = createFakeNative();
    const tray = createTray(api);
    try {
      expect(tray.setIcon({ base64: TRAY_ICON_BASE64.active })).toBe(true);
      expect(tray.setIcon(iconPath)).toBe(true);
      expect(tray.setIcon({ path: iconPath })).toBe(true);
      expect(tray.setIcon({ rgba: Buffer.alloc(4), width: 1, height: 1 })).toBe(true);

      const icons = api.calls.icons;
      expect(icons[icons.length - 3]).toEqual({ path: iconPath });
      expect(icons[icons.length - 2]).toEqual({ path: iconPath });
      const last = icons[icons.length - 1];
      expect(last).toMatchObject({ width: 1, height: 1 });
      expect(Buffer.isBuffer(last.rgba)).toBe(true);

      tray.close();
      expect(tray.setIcon({ base64: TRAY_ICON_BASE64.idle })).toBe(false);
    } finally {
      tray.close();
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("updates menu labels, enabled state, and checkable state", () => {
    const api = createFakeNative();
    const tray = TrayIcon.create(
      {
        icon: { base64: TRAY_ICON_BASE64.idle },
        menu: [{ id: "record", label: "Record", checkable: true, checked: false }],
      },
      api
    );

    expect(api.menuEnabled.get("record")).toBe(true);
    expect(tray.updateMenuItem("record", { label: "Recording", enabled: false, checked: true })).toBe(
      true
    );
    expect(api.menuText.get("record")).toBe("Recording");
    expect(api.menuEnabled.get("record")).toBe(false);
    expect(tray.isMenuItemChecked("record")).toBe(true);
    expect(tray.toggleMenuItem("record")).toBe(false);
    expect(tray.isMenuItemChecked("record")).toBe(false);
    expect(tray.toggleMenuItem("record")).toBe(true);
    expect(tray.isMenuItemChecked("record")).toBe(true);

    tray.close();
  });

  it("flips a checkable menu entry false -> true -> false across two toggles", () => {
    const api = createFakeNative();
    const tray = TrayIcon.create(
      {
        icon: { ...ICON },
        menu: [{ id: "auto", label: "Auto toggle", checkable: true, checked: false }],
      },
      api
    );

    try {
      expect(api.calls.menuItems).toContainEqual({
        id: "auto",
        label: "Auto toggle",
        enabled: true,
        checkable: true,
      });
      expect(tray.isMenuItemChecked("auto")).toBe(false);
      expect(api.checks.get("auto")).toBe(false);

      expect(tray.toggleMenuItem("auto")).toBe(true);
      expect(tray.isMenuItemChecked("auto")).toBe(true);
      expect(api.checks.get("auto")).toBe(true);

      expect(tray.toggleMenuItem("auto")).toBe(false);
      expect(tray.isMenuItemChecked("auto")).toBe(false);
      expect(api.checks.get("auto")).toBe(false);
    } finally {
      tray.close();
    }
  });

  it("applies label and enabled patches to handles without checkable support", () => {
    const api = createFakeNative();
    class PlainMenuItem {
      text = "";
      enabled = true;
      setText(text: string): void {
        this.text = text;
      }
      setEnabled(enabled: boolean): void {
        this.enabled = enabled;
      }
    }
    api.MenuItemBuilder = class {
      private readonly item = new PlainMenuItem();
      withText(text: string) {
        this.item.setText(text);
        return this;
      }
      withEnabled(enabled: boolean) {
        this.item.setEnabled(enabled);
        return this;
      }
      withId() {
        return this;
      }
      build(): PlainMenuItem {
        return this.item;
      }
    } as unknown as NativeModule["MenuItemBuilder"];

    const tray = TrayIcon.create({ icon: { ...ICON }, menu: [{ id: "plain", label: "Plain" }] }, api);
    try {
      expect(tray.updateMenuItem("plain", { label: "Renamed", enabled: false, checked: true })).toBe(
        true
      );
    } finally {
      tray.close();
    }
  });

  it("applies tooltip, title, visibility, and handler registration updates", () => {
    const api = createFakeNative();
    const seen: string[] = [];
    const handler = (id: string) => seen.push(`global:${id}`);
    const tray = TrayIcon.create(
      {
        icon: { base64: TRAY_ICON_BASE64.idle },
        menu: [{ id: "quit", label: "Quit", onClick: (id) => seen.push(`item:${id}`) }],
      },
      api
    );
    try {
      expect(tray.setTooltip("new tooltip")).toBe(true);
      expect(tray.setTitle("tray title")).toBe(true);
      expect(tray.setVisible(false)).toBe(true);
      expect(api.calls.tooltips).toContain("new tooltip");
      expect(api.calls.titles).toContain("tray title");
      expect(api.calls.visibility).toContain(false);

      tray.on("quit", handler);
      api.queueMenuEvent("quit");
      expect(tray.poll()).toEqual(["quit"]);
      expect(seen).toEqual(["global:quit", "item:quit"]);

      tray.off("quit", handler);
      tray.off("missing", handler);
      api.queueMenuEvent("quit");
      expect(tray.poll()).toEqual(["quit"]);
      expect(seen).toEqual(["global:quit", "item:quit", "item:quit"]);
    } finally {
      tray.close();
    }
  });

  it("returns false for unknown menu entries and trays without a menu", () => {
    const api = createFakeNative();
    const withMenu = TrayIcon.create(
      { icon: { ...ICON }, menu: [{ id: "item", label: "Item" }] },
      api
    );
    const withoutMenu = createTray(api);
    try {
      expect(withMenu.updateMenuItem("missing", { label: "Ignored" })).toBe(false);
      expect(withMenu.isMenuItemChecked("item")).toBe(false);
      expect(withoutMenu.isMenuItemChecked("item")).toBe(false);
      expect(withoutMenu.toggleMenuItem("item")).toBe(false);
      expect(withoutMenu.updateMenuItem("item", { label: "Ignored" })).toBe(false);
    } finally {
      withMenu.close();
      withoutMenu.close();
    }
  });

  it("falls back to normal menu items and skips separators without native builders", () => {
    const api = createFakeNative();
    api.CheckMenuItemBuilder = undefined;
    api.PredefinedMenuItem = undefined;
    const tray = TrayIcon.create(
      {
        icon: { ...ICON },
        menu: [
          { id: "sep", label: "", separator: true },
          { id: "check", label: "Check", checkable: true, checked: true, enabled: false },
        ],
      },
      api
    );
    try {
      expect(api.calls.menuItems).toHaveLength(1);
      expect(api.calls.menuItems[0]).toMatchObject({
        id: "check",
        label: "Check",
        enabled: false,
        checkable: false,
      });
    } finally {
      tray.close();
    }
  });

  it("degrades after native icon resolution fails and ignores later mutations", () => {
    const log: string[] = [];
    const api = createFakeNative();
    const tray = createTray(api, (message) => log.push(message));

    expect(tray.setIcon({ base64: "" })).toBe(false);
    expect(tray.active).toBe(false);
    expect(log.join(" ")).toContain("tray disabled after native failure");
    expect(tray.setTooltip("ignored")).toBe(false);
    expect(tray.setTitle("ignored")).toBe(false);
    expect(tray.setVisible(true)).toBe(false);
    expect(tray.updateMenuItem("item", { label: "ignored" })).toBe(false);
    expect(tray.isMenuItemChecked("item")).toBe(false);
    expect(tray.toggleMenuItem("item")).toBe(false);
    expect(tray.poll()).toEqual([]);
  });

  it("degrades when tooltip, title, or visibility updates fail", () => {
    const failures: Array<{
      message: string;
      break: (host: NativeTrayHost) => void;
      call: (tray: TrayIcon) => boolean;
    }> = [
      {
        message: "tooltip down",
        break: (host) => {
          host.setTooltip = () => {
            throw new Error("tooltip down");
          };
        },
        call: (tray) => tray.setTooltip("x"),
      },
      {
        message: "title down",
        break: (host) => {
          host.setTitle = () => {
            throw new Error("title down");
          };
        },
        call: (tray) => tray.setTitle("x"),
      },
      {
        message: "visibility down",
        break: (host) => {
          host.setVisible = () => {
            throw new Error("visibility down");
          };
        },
        call: (tray) => tray.setVisible(true),
      },
    ];

    for (const failure of failures) {
      const log: string[] = [];
      const api = createFakeNative();
      const tray = createTray(api, (message) => log.push(message));
      try {
        failure.break(api.trays[api.trays.length - 1]);
        expect(failure.call(tray)).toBe(false);
        expect(tray.active).toBe(false);
        expect(log.join(" ")).toContain(failure.message);
      } finally {
        tray.close();
      }
    }
  });

  it("degrades when a menu entry update throws", () => {
    const api = createFakeNative();
    class FailingMenu {
      appendMenuItem(item: NativeMenuItemHandle): void {
        item.setText = () => {
          throw new Error("menu text down");
        };
        item.setEnabled = () => {
          throw new Error("menu enabled down");
        };
      }
      appendCheckMenuItem(item: NativeCheckMenuItemHandle): void {
        this.appendMenuItem(item);
      }
      appendPredefinedMenuItem(): void {}
      isChecked(): boolean {
        return false;
      }
      toggleCheck(): boolean {
        return false;
      }
      setText(): void {}
    }
    api.Menu = FailingMenu as unknown as NativeModule["Menu"];
    const log: string[] = [];
    const tray = TrayIcon.create(
      { icon: { ...ICON }, menu: [{ id: "item", label: "Item" }], log: (m) => log.push(m) },
      api
    );
    try {
      expect(tray.updateMenuItem("item", { label: "Renamed", enabled: false })).toBe(false);
      expect(tray.active).toBe(false);
      expect(log.join(" ")).toContain("menu text down");
    } finally {
      tray.close();
    }
  });

  it("degrades when a menu read or toggle throws", () => {
    function apiWithMenu(read: () => boolean, toggle: () => boolean) {
      const api = createFakeNative();
      class TestMenu {
        appendMenuItem(): void {}
        appendCheckMenuItem(): void {}
        appendPredefinedMenuItem(): void {}
        isChecked(): boolean {
          return read();
        }
        toggleCheck(): boolean {
          return toggle();
        }
        setText(): void {}
      }
      api.Menu = TestMenu as unknown as NativeModule["Menu"];
      return api;
    }

    const readLog: string[] = [];
    const readApi = apiWithMenu(() => {
      throw new Error("menu read down");
    }, () => false);
    const readTray = TrayIcon.create(
      { icon: { ...ICON }, menu: [{ id: "item", label: "Item" }], log: (m) => readLog.push(m) },
      readApi
    );
    try {
      expect(readTray.isMenuItemChecked("item")).toBe(false);
      expect(readTray.active).toBe(false);
      expect(readLog.join(" ")).toContain("menu read down");
    } finally {
      readTray.close();
    }

    const toggleLog: string[] = [];
    const toggleApi = apiWithMenu(() => false, () => {
      throw new Error("menu toggle down");
    });
    const toggleTray = TrayIcon.create(
      { icon: { ...ICON }, menu: [{ id: "item", label: "Item" }], log: (m) => toggleLog.push(m) },
      toggleApi
    );
    try {
      expect(toggleTray.toggleMenuItem("item")).toBe(false);
      expect(toggleTray.active).toBe(false);
      expect(toggleLog.join(" ")).toContain("menu toggle down");
    } finally {
      toggleTray.close();
    }
  });

  it("forwards native tray events and degrades when the event pump fails", () => {
    const api = createFakeNative();
    const events: string[] = [];
    const log: string[] = [];
    const tray = TrayIcon.create(
      {
        icon: { ...ICON },
        onEvent: (event: NativeTrayEvent) => events.push(event.eventType),
        log: (message) => log.push(message),
      },
      api
    );
    try {
      const event: NativeTrayEvent = {
        eventType: "click",
        id: "tray",
        x: 0,
        y: 0,
        iconRect: { x: 0, y: 0, width: 16, height: 16 },
        button: 1,
        buttonState: 1,
      };
      const queue: NativeTrayEvent[] = [event];
      api.pollTrayEvents = () => queue.shift() ?? null;
      expect(tray.poll()).toEqual([]);
      expect(events).toEqual(["click"]);

      api.update = () => {
        throw new Error("pump down");
      };
      expect(tray.poll()).toEqual([]);
      expect(tray.active).toBe(false);
      expect(log.join(" ")).toContain("pump down");
    } finally {
      tray.close();
    }
  });

  it("logs failures from menu handlers and keeps the tray alive", () => {
    const api = createFakeNative();
    const log: string[] = [];
    const tray = TrayIcon.create(
      {
        icon: { ...ICON },
        menu: [
          {
            id: "boom",
            label: "Boom",
            onClick: () => {
              throw new Error("item handler down");
            },
          },
        ],
        log: (message) => log.push(message),
      },
      api
    );
    try {
      tray.on("boom", () => {
        throw new Error("global handler down");
      });
      api.queueMenuEvent("boom");
      expect(tray.poll()).toEqual(["boom"]);
      expect(log.join(" ")).toContain("global handler down");
      expect(log.join(" ")).toContain("item handler down");
      expect(tray.active).toBe(true);
    } finally {
      tray.close();
    }
  });

  it("rejects invalid options and returns a disabled tray instead of throwing when creation fails", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const api = createFakeNative();
      expect(() => TrayIcon.create({ icon: undefined as never }, api)).toThrow(TrayError);
      expect(TrayIcon.tryCreate({ icon: undefined as never }, api)).toBeUndefined();

      api.TrayIconBuilder = class {
        withIcon() {
          return this;
        }
        withTooltip() {
          return this;
        }
        withTitle() {
          return this;
        }
        withMenu() {
          return this;
        }
        build(): never {
          throw new Error("no tray host");
        }
      } as never;
      expect(TrayIcon.tryCreate({ icon: { ...ICON } }, api)).toBeUndefined();

      const failingApi = createFakeNative();
      failingApi.initialize = () => {
        throw new TrayError("init down");
      };
      expect(() => TrayIcon.create({ icon: { ...ICON } }, failingApi)).toThrow(TrayError);
    } finally {
      warn.mockRestore();
    }
  });

  it("disposes materialized icons when creation fails mid-way", () => {
    const api = createFakeNative();
    expect(() =>
      TrayIcon.create({ icon: { base64: TRAY_ICON_BASE64.idle } }, {
        ...api,
        TrayIconBuilder: class {
          withIcon() {
            return this;
          }
          withTooltip() {
            return this;
          }
          withTitle() {
            return this;
          }
          withMenu() {
            return this;
          }
          build(): never {
            throw new Error("builder down");
          }
        },
      } as unknown as NativeModule)
    ).toThrow(TrayError);
  });
});
