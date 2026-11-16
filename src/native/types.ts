/**
 * @module for-os.native.types
 * @description Structural types for the vendored `tray-icon-node` NAPI-RS addon.
 * @summary These mirror `native/tray-icon-node/index.d.ts` but stay deliberately
 * narrow so the bridges can be exercised with a fake native module in tests.
 */

/** Rectangle reported for tray-icon events. */
export type NativeRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Raw tray-icon event emitted by the native event loop. */
export type NativeTrayEvent = {
  eventType: string;
  id: string;
  x: number;
  y: number;
  iconRect: NativeRect;
  button: number;
  buttonState: number;
};

/** Menu event emitted when the user activates a menu item. */
export type NativeMenuEvent = { id: string };

/** Handle to a native menu entry. */
export type NativeMenuItemHandle = {
  setText(text: string): void;
  setEnabled(enabled: boolean): void;
};

/** Handle to a native checkable menu entry. */
export type NativeCheckMenuItemHandle = NativeMenuItemHandle & {
  isChecked(): boolean;
  setChecked(checked: boolean): void;
};

/** Handle to a native menu (or submenu). */
export type NativeMenuHandle = {
  appendMenuItem(item: NativeMenuItemHandle, id?: string | null): void;
  appendCheckMenuItem(item: NativeCheckMenuItemHandle, id: string): void;
  appendPredefinedMenuItem(item: unknown): void;
  isChecked(id: string): boolean;
  toggleCheck(id: string): boolean;
  setText(id: string, text: string): void;
};

/** Handle to a live native tray icon. */
export type NativeTrayHost = {
  setIcon(icon: unknown | null): void;
  setTooltip(tooltip: string | null): void;
  setTitle(title: string | null): void;
  setVisible(visible: boolean): void;
};

/** Native icon factory. */
export type NativeIconFactory = {
  fromPath(path: string): unknown;
  fromRgba(rgba: Buffer | Uint8Array, width: number, height: number): unknown;
};

/** Native tray-icon builder. */
export type NativeTrayIconBuilder = {
  withIcon(icon: unknown): NativeTrayIconBuilder;
  withTooltip(tooltip: string): NativeTrayIconBuilder;
  withTitle(title: string): NativeTrayIconBuilder;
  withMenu(menu: NativeMenuHandle): NativeTrayIconBuilder;
  build(): NativeTrayHost;
};

/** Notification action button understood by the native addon. */
export type NativeNotificationAction = { id: string; label: string };

/**
 * The subset of the `tray-icon-node` module consumed by the TypeScript bridges.
 * Optional members are absent on older locally built binaries.
 */
export type NativeModule = {
  initialize(): void;
  update(): void;
  Icon: NativeIconFactory;
  Menu: new () => NativeMenuHandle;
  MenuItemBuilder: new () => {
    withText(text: string): unknown;
    withEnabled(enabled: boolean): unknown;
    withId(id: string): unknown;
    build(): NativeMenuItemHandle;
  };
  CheckMenuItemBuilder?: new () => {
    withText(text: string): unknown;
    withEnabled(enabled: boolean): unknown;
    withChecked(checked: boolean): unknown;
    withId(id: string): unknown;
    build(): NativeCheckMenuItemHandle;
  };
  PredefinedMenuItem?: { separator(): unknown };
  TrayIconBuilder: new () => NativeTrayIconBuilder;
  pollMenuEvents(): NativeMenuEvent | null;
  pollTrayEvents?(): NativeTrayEvent | null;
  showNotification(title: string, body: string, timeoutMs?: number | null): void;
  showNotificationWithActions?(
    title: string,
    body: string,
    actions: NativeNotificationAction[],
    timeoutMs?: number | null
  ): void;
  showAppointmentNotification?(
    title: string,
    body: string,
    timeoutMs?: number | null
  ): void;
  pollNotificationActions?(): string | null;
};
