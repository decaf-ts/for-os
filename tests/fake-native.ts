import type {
  NativeCheckMenuItemHandle,
  NativeMenuHandle,
  NativeMenuItemHandle,
  NativeModule,
  NativeNotificationAction,
  NativeTrayEvent,
  NativeTrayHost,
} from "../src/native/types";

export type FakeIcon = { path?: string; rgba?: Buffer; width?: number; height?: number };

export type FakeCallLog = {
  initialized: number;
  updated: number;
  icons: FakeIcon[];
  tooltips: Array<string | null>;
  titles: Array<string | null>;
  visibility: boolean[];
  notifications: Array<{
    title: string;
    body: string;
    timeoutMs?: number | null;
    actions?: NativeNotificationAction[];
    appointment?: boolean;
  }>;
  menuItems: Array<{ id?: string | null; label: string; enabled: boolean; checkable: boolean }>;
  hidden: boolean[];
};

export type FakeNative = NativeModule & {
  calls: FakeCallLog;
  trays: NativeTrayHost[];
  menuEvents: string[];
  notificationActions: string[];
  checks: Map<string, boolean>;
  menuText: Map<string, string>;
  menuEnabled: Map<string, boolean>;
  queueMenuEvent(id: string): void;
  queueNotificationAction(id: string): void;
};

class FakeMenuItem implements NativeMenuItemHandle, NativeCheckMenuItemHandle {
  constructor(
    private readonly native: FakeNative,
    public readonly label: string,
    public enabled: boolean,
    public checked = false
  ) {}

  setText(text: string): void {
    this.native.menuText.set(handles.get(this) ?? "", text);
    (this as { label: string }).label = text;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    const id = handles.get(this);
    if (id) this.native.menuEnabled.set(id, enabled);
  }

  isChecked(): boolean {
    return this.checked;
  }

  setChecked(checked: boolean): void {
    this.checked = checked;
    const id = handles.get(this);
    if (id) this.native.checks.set(id, checked);
  }
}

const handles = new WeakMap<NativeMenuItemHandle, string>();

function builder<T extends { withText(text: string): T; withEnabled(enabled: boolean): T; withId(id: string): T }>(
  native: FakeNative,
  factory: (label: string, enabled: boolean, checked: boolean, id: string) => NativeMenuItemHandle & NativeCheckMenuItemHandle,
  checkable: boolean
): T {
  let text = "";
  let enabled = true;
  let checked = false;
  let id = "";
  const value = {
    withText(value: string) {
      text = value;
      return this;
    },
    withEnabled(value: boolean) {
      enabled = value;
      return this;
    },
    withChecked(value: boolean) {
      checked = value;
      return this;
    },
    withId(value: string) {
      id = value;
      return this;
    },
    build() {
      const handle = factory(text, enabled, checked, id);
      handles.set(handle, id);
      native.calls.menuItems.push({ id, label: text, enabled, checkable });
      return handle;
    },
  };
  return value as unknown as T;
}

/**
 * Builds an in-memory stand-in for the NAPI-RS addon.
 * @return {FakeNative} a native module whose calls and events are inspectable
 */
export function createFakeNative(): FakeNative {
  const calls: FakeCallLog = {
    initialized: 0,
    updated: 0,
    icons: [],
    tooltips: [],
    titles: [],
    visibility: [],
    notifications: [],
    menuItems: [],
    hidden: [],
  };
  const native = {
    calls,
    trays: [] as NativeTrayHost[],
    menuEvents: [] as string[],
    notificationActions: [] as string[],
    checks: new Map<string, boolean>(),
    menuText: new Map<string, string>(),
    menuEnabled: new Map<string, boolean>(),
    initialize() {
      calls.initialized++;
    },
    update() {
      calls.updated++;
    },
    Icon: {
      fromPath(path: string) {
        return { path };
      },
      fromRgba(rgba: Buffer | Uint8Array, width: number, height: number) {
        return { rgba: Buffer.from(rgba), width, height };
      },
    },
    Menu: class implements NativeMenuHandle {
      appendMenuItem(item: NativeMenuItemHandle, id?: string | null): void {
        const key = id ?? handles.get(item) ?? "";
        native.checks.set(key, false);
        native.menuText.set(key, (item as FakeMenuItem).label);
        native.menuEnabled.set(key, (item as FakeMenuItem).enabled);
      }
      appendCheckMenuItem(item: NativeCheckMenuItemHandle, id: string): void {
        native.checks.set(id, item.isChecked());
        native.menuText.set(id, (item as FakeMenuItem).label);
        native.menuEnabled.set(id, (item as FakeMenuItem).enabled);
      }
      appendPredefinedMenuItem(): void {
        // separators carry no id
      }
      isChecked(id: string): boolean {
        return native.checks.get(id) ?? false;
      }
      toggleCheck(id: string): boolean {
        const next = !(native.checks.get(id) ?? false);
        native.checks.set(id, next);
        return next;
      }
      setText(id: string, text: string): void {
        native.menuText.set(id, text);
      }
    },
    MenuItemBuilder: class {
      constructor() {
        return builder(native, (label, enabled) => new FakeMenuItem(native, label, enabled), false) as never;
      }
    },
    CheckMenuItemBuilder: class {
      constructor() {
        return builder(
          native,
          (label, enabled, checked) => new FakeMenuItem(native, label, enabled, checked),
          true
        ) as never;
      }
    },
    PredefinedMenuItem: {
      separator() {
        return { separator: true };
      },
    },
    TrayIconBuilder: class {
      private options: {
        icon?: unknown;
        tooltip?: string;
        title?: string;
      } = {};
      withIcon(icon: unknown) {
        this.options.icon = icon;
        return this;
      }
      withTooltip(tooltip: string) {
        this.options.tooltip = tooltip;
        return this;
      }
      withTitle(title: string) {
        this.options.title = title;
        return this;
      }
      withMenu() {
        return this;
      }
      build(): NativeTrayHost {
        const host: NativeTrayHost = {
          setIcon(icon: unknown) {
            calls.icons.push(icon as FakeIcon);
          },
          setTooltip(tooltip: string | null) {
            calls.tooltips.push(tooltip);
          },
          setTitle(title: string | null) {
            calls.titles.push(title);
          },
          setVisible(visible: boolean) {
            calls.visibility.push(visible);
          },
        };
        native.trays.push(host);
        return host;
      }
    },
    pollMenuEvents() {
      const id = native.menuEvents.shift();
      return id ? { id } : null;
    },
    pollTrayEvents(): NativeTrayEvent | null {
      return null;
    },
    showNotification(title: string, body: string, timeoutMs?: number | null) {
      calls.notifications.push({ title, body, timeoutMs });
    },
    showNotificationWithActions(
      title: string,
      body: string,
      actions: NativeNotificationAction[],
      timeoutMs?: number | null
    ) {
      calls.notifications.push({ title, body, actions, timeoutMs });
    },
    showAppointmentNotification(title: string, body: string, timeoutMs?: number | null) {
      calls.notifications.push({ title, body, appointment: true, timeoutMs });
    },
    pollNotificationActions() {
      return native.notificationActions.shift() ?? null;
    },
    queueMenuEvent(id: string) {
      native.menuEvents.push(id);
    },
    queueNotificationAction(id: string) {
      native.notificationActions.push(id);
    },
  };
  return native as unknown as FakeNative;
}
