/**
 * @module for-os.tray
 * @description Runtime-switchable system-tray icon and menu bridge.
 * @summary `TrayIcon` owns one native tray host, a menu with JavaScript
 * callbacks, and the cooperative native event pump. Icons can be replaced at
 * runtime with {@link TrayIcon.setIcon} (path, bytes, base64, or RGBA), menu
 * entries can be relabelled/enabled/checked, and unknown native failures
 * degrade the tray without throwing into the host application.
 */

import { TrayError } from "../errors";
import { IconResolver, type IconSource } from "../native/icons";
import { requireNativeModule } from "../native/loader";
import type {
  NativeCheckMenuItemHandle,
  NativeMenuHandle,
  NativeMenuItemHandle,
  NativeModule,
  NativeTrayEvent,
  NativeTrayHost,
} from "../native/types";

/** Callback invoked when a tray menu action is activated. */
export type TrayActionHandler = (id: string) => void;

/** One entry in the tray menu. */
export type TrayMenuItem = {
  /** Stable action id reported to {@link TrayActionHandler}s. */
  id: string;
  /** Rendered label. */
  label: string;
  /** Whether the entry is clickable (defaults to true). */
  enabled?: boolean;
  /** Renders a checkable item instead of a normal item. */
  checkable?: boolean;
  /** Initial checked state for a checkable item. */
  checked?: boolean;
  /** Renders a separator instead of a labelled item. */
  separator?: boolean;
  /** Per-item callback; global handlers registered with {@link TrayIcon.on} also run. */
  onClick?: TrayActionHandler;
};

/** Mutable fields accepted by {@link TrayIcon.updateMenuItem}. */
export type TrayMenuItemPatch = {
  /** Replacement label text. */
  label?: string;
  /** Whether the entry is clickable. */
  enabled?: boolean;
  /** New checked state for a checkable item. */
  checked?: boolean;
};

/** Construction options for {@link TrayIcon}. */
export type TrayIconOptions = {
  /** Initial tray icon. */
  icon: IconSource;
  /** Hover tooltip. */
  tooltip?: string;
  /** macOS title text shown next to the icon. */
  title?: string;
  /** Menu entries; omitted means the tray has no context menu. */
  menu?: TrayMenuItem[];
  /** Native event pump interval in milliseconds (defaults to 100). */
  pollIntervalMs?: number;
  /** Best-effort diagnostics sink (defaults to `console.warn`). */
  log?: (message: string) => void;
  /** Raw tray-icon events (click/enter/leave/move). */
  onEvent?: (event: NativeTrayEvent) => void;
};

type MenuHandles = Map<string, NativeMenuItemHandle | NativeCheckMenuItemHandle>;

/** Interval of the cooperative native event pump while a tray exists. */
const DEFAULT_POLL_INTERVAL_MS = 100;

function defaultLog(message: string): void {
  console.warn(message);
}

/**
 * @description A live system-tray icon with a JavaScript-driven menu.
 * @summary Create one with {@link TrayIcon.create}. Call {@link close} when the
 * host application shuts the tray down. `active` turns false after a native
 * failure; every mutating method is a no-op after that.
 * @class TrayIcon
 * @example
 * import { TrayIcon, TRAY_ICON_BASE64 } from "@decaf-ts/for-os";
 * const tray = TrayIcon.create({
 *   icon: { base64: TRAY_ICON_BASE64.idle },
 *   tooltip: "Decaf",
 *   menu: [{ id: "quit", label: "Quit" }],
 * });
 * tray.on("quit", () => tray.close());
 */
export class TrayIcon {
  private readonly handlers = new Map<string, Set<TrayActionHandler>>();
  private readonly itemHandlers = new Map<string, TrayActionHandler>();
  private readonly menuHandles: MenuHandles = new Map<string, NativeMenuItemHandle | NativeCheckMenuItemHandle>();
  private readonly menu?: NativeMenuHandle;
  private readonly resolver: IconResolver;
  private readonly log: (message: string) => void;
  private readonly pollIntervalMs: number;
  private readonly onEvent?: (event: NativeTrayEvent) => void;
  private pump?: ReturnType<typeof setInterval>;
  private closed = false;
  private isActive = true;

  private constructor(
    private readonly api: NativeModule,
    private readonly host: NativeTrayHost,
    options: TrayIconOptions,
    menu: NativeMenuHandle | undefined,
    resolver: IconResolver,
    handles: Array<{
      id: string;
      entry: TrayMenuItem;
      handle: NativeMenuItemHandle | NativeCheckMenuItemHandle;
    }>
  ) {
    this.menu = menu;
    this.log = options.log ?? defaultLog;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.onEvent = options.onEvent;
    this.resolver = resolver;
    for (const { id, entry, handle } of handles) {
      this.menuHandles.set(id, handle);
      if (entry.onClick) this.itemHandlers.set(id, entry.onClick);
    }
    this.startPump();
  }

  /**
   * Creates a tray icon and its menu.
   * @param {TrayIconOptions} options icon, tooltip, title, and menu entries
   * @param {NativeModule} [api] native module override (tests/embedding)
   * @return {TrayIcon} the live tray
   * @throws {NativeModuleUnavailableError} when the native addon is unavailable
   * @throws {TrayError} when the native tray host or menu cannot be created
   */
  static create(options: TrayIconOptions, api: NativeModule = requireNativeModule()): TrayIcon {
    if (!options?.icon) throw new TrayError("TrayIcon requires an icon source.");
    const resolver = new IconResolver(api.Icon);
    let menu: NativeMenuHandle | undefined;
    const handles: Array<{ id: string; entry: TrayMenuItem; handle: NativeMenuItemHandle | NativeCheckMenuItemHandle }> = [];
    try {
      api.initialize();
      const icon = resolver.resolve(options.icon);
      if (options.menu?.length) {
        menu = new api.Menu();
        for (const entry of options.menu) {
          if (entry.separator) {
            const separator = api.PredefinedMenuItem?.separator();
            if (separator) menu.appendPredefinedMenuItem(separator);
            continue;
          }
          if (entry.checkable && api.CheckMenuItemBuilder) {
            const builder = new api.CheckMenuItemBuilder();
            builder.withId(entry.id);
            builder.withText(entry.label);
            builder.withEnabled(entry.enabled ?? true);
            builder.withChecked(entry.checked ?? false);
            const handle = builder.build();
            menu.appendCheckMenuItem(handle, entry.id);
            handles.push({ id: entry.id, entry, handle });
            continue;
          }
          const builder = new api.MenuItemBuilder();
          builder.withId(entry.id);
          builder.withText(entry.label);
          builder.withEnabled(entry.enabled ?? true);
          const handle = builder.build();
          menu.appendMenuItem(handle, entry.id);
          handles.push({ id: entry.id, entry, handle });
        }
      }
      const builder = new api.TrayIconBuilder();
      builder.withIcon(icon);
      if (options.tooltip) builder.withTooltip(options.tooltip);
      if (options.title) builder.withTitle(options.title);
      if (menu) builder.withMenu(menu);
      const host = builder.build();
      return new TrayIcon(api, host, options, menu, resolver, handles);
    } catch (error) {
      resolver.dispose();
      if (error instanceof TrayError) throw error;
      throw new TrayError(error);
    }
  }

  /**
   * Creates a tray icon, returning `undefined` instead of throwing.
   * @param {TrayIconOptions} options tray construction options
   * @param {NativeModule} [api] native module override
   * @return {TrayIcon|undefined} the tray, or `undefined` when it cannot be created
   */
  static tryCreate(options: TrayIconOptions, api?: NativeModule): TrayIcon | undefined {
    try {
      return TrayIcon.create(options, api);
    } catch (error) {
      (options.log ?? defaultLog)(
        `for-os: tray unavailable (${error instanceof Error ? error.message : String(error)}).`
      );
      return undefined;
    }
  }

  /** Whether the tray still exists and has not degraded. */
  get active(): boolean {
    return this.isActive && !this.closed;
  }

  /**
   * Switches the tray icon at runtime.
   * @param {IconSource} source the new icon
   * @return {boolean} `true` when applied
   */
  setIcon(source: IconSource): boolean {
    if (!this.active) return false;
    try {
      this.host.setIcon(this.resolver.resolve(source));
      this.pumpOnce();
      return true;
    } catch (error) {
      this.degrade(error);
      return false;
    }
  }

  /**
   * Updates the hover tooltip.
   * @param {string} tooltip new tooltip text
   * @return {boolean} `true` when applied
   */
  setTooltip(tooltip: string): boolean {
    if (!this.active) return false;
    try {
      this.host.setTooltip(tooltip);
      return true;
    } catch (error) {
      this.degrade(error);
      return false;
    }
  }

  /**
   * Updates the macOS title text.
   * @param {string} title new title
   * @return {boolean} `true` when applied
   */
  setTitle(title: string): boolean {
    if (!this.active) return false;
    try {
      this.host.setTitle(title);
      return true;
    } catch (error) {
      this.degrade(error);
      return false;
    }
  }

  /**
   * Shows or hides the tray icon.
   * @param {boolean} visible desired visibility
   * @return {boolean} `true` when applied
   */
  setVisible(visible: boolean): boolean {
    if (!this.active) return false;
    try {
      this.host.setVisible(visible);
      return true;
    } catch (error) {
      this.degrade(error);
      return false;
    }
  }

  /**
   * Registers a global menu-action handler.
   * @param {string} id menu action id
   * @param {TrayActionHandler} handler callback
   * @return {TrayIcon} this instance
   */
  on(id: string, handler: TrayActionHandler): this {
    const handlers = this.handlers.get(id) ?? new Set<TrayActionHandler>();
    handlers.add(handler);
    this.handlers.set(id, handlers);
    return this;
  }

  /**
   * Removes a previously registered global handler.
   * @param {string} id menu action id
   * @param {TrayActionHandler} handler callback to remove
   * @return {TrayIcon} this instance
   */
  off(id: string, handler: TrayActionHandler): this {
    this.handlers.get(id)?.delete(handler);
    return this;
  }

  /**
   * Relabels, enables/disables, or checks a menu entry.
   * @param {string} id menu entry id
   * @param {TrayMenuItemPatch} patch fields to update
   * @return {boolean} `true` when the entry exists and the change was applied
   */
  updateMenuItem(id: string, patch: TrayMenuItemPatch): boolean {
    if (!this.active) return false;
    const handle = this.menuHandles.get(id);
    if (!handle) return false;
    try {
      if (typeof patch.label === "string") handle.setText(patch.label);
      if (typeof patch.enabled === "boolean") handle.setEnabled(patch.enabled);
      if (typeof patch.checked === "boolean" && "setChecked" in handle) {
        (handle as NativeCheckMenuItemHandle).setChecked(patch.checked);
      }
      return true;
    } catch (error) {
      this.degrade(error);
      return false;
    }
  }

  /**
   * Reads the checked state of a checkable menu entry.
   * @param {string} id menu entry id
   * @return {boolean} whether the entry is checked
   */
  isMenuItemChecked(id: string): boolean {
    if (!this.active || !this.menu) return false;
    try {
      return this.menu.isChecked(id);
    } catch (error) {
      this.degrade(error);
      return false;
    }
  }

  /**
   * Toggles a checkable menu entry.
   * @param {string} id menu entry id
   * @return {boolean} the resulting checked state
   */
  toggleMenuItem(id: string): boolean {
    if (!this.active || !this.menu) return false;
    try {
      this.menu.toggleCheck(id);
      return this.menu.isChecked(id);
    } catch (error) {
      this.degrade(error);
      return false;
    }
  }

  /**
   * Processes pending native events immediately.
   * @return {string[]} menu action ids dispatched in this drain
   */
  poll(): string[] {
    return this.pumpOnce();
  }

  /** Releases the native tray, event pump, and materialized icon files; idempotent. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.pump) clearInterval(this.pump);
    this.pump = undefined;
    try {
      this.host.setVisible(false);
    } catch {
      // The desktop host may already have removed the tray; nothing to release.
    }
    this.resolver.dispose();
    this.isActive = false;
  }

  private startPump(): void {
    this.pump = setInterval(() => this.pumpOnce(), this.pollIntervalMs);
    this.pump.unref?.();
    this.pumpOnce();
  }

  private pumpOnce(): string[] {
    if (!this.active) return [];
    const dispatched: string[] = [];
    try {
      this.api.update();
      for (let event = this.api.pollMenuEvents(); event; event = this.api.pollMenuEvents()) {
        this.dispatchMenuAction(event.id);
        dispatched.push(event.id);
      }
      if (this.api.pollTrayEvents && this.onEvent) {
        for (let event = this.api.pollTrayEvents(); event; event = this.api.pollTrayEvents()) {
          this.onEvent(event);
        }
      }
      return dispatched;
    } catch (error) {
      this.degrade(error);
      return dispatched;
    }
  }

  private dispatchMenuAction(id: string): void {
    const handlers = this.handlers.get(id);
    if (handlers) {
      for (const handler of handlers) this.invoke(id, handler);
    }
    const item = this.itemHandlers.get(id);
    if (item) this.invoke(id, item);
  }

  private invoke(id: string, handler: TrayActionHandler): void {
    try {
      handler(id);
    } catch (error) {
      this.log(
        `for-os: tray action "${id}" handler failed (${error instanceof Error ? error.message : String(error)}).`
      );
    }
  }

  private degrade(error: unknown): void {
    this.log(
      `for-os: tray disabled after native failure (${error instanceof Error ? error.message : String(error)}).`
    );
    this.close();
  }
}
