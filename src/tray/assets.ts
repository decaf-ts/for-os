/**
 * @module for-os.tray.assets
 * @description Embedded 16x16 tray icons for runtime icon-switching examples.
 * @summary Icons are base64 PNG strings so no binary asset has to be resolved
 * at runtime. Pass them directly to {@link TrayIcon.setIcon} or decode them
 * with {@link trayIconPng}.
 */

/**
 * Embedded base64 PNG icons keyed by tray state.
 * @summary Values are 16x16 PNGs encoded as base64 strings. Decode them with
 * {@link trayIconPng}, or pass `{ base64 }` directly to
 * {@link TrayIcon.setIcon}.
 * @constant
 * @readonly
 */
export const TRAY_ICON_BASE64 = {
  /** Base64 PNG shown while the tray is idle. */
  idle: "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAaUlEQVR42q2TwQ3AIAhFvbof2zDC28IZvbdpIkljitHC4V0k/0UBC1AieIUKCKADGWdbgifQgWuij9pS0D6CM80T6EbY0FlQnWt7dOuJCeQgbMhboD8EmioIPyHcxPAYUxYpZZVTPtMRNxn8JW/L/TDsAAAAAElFTkSuQmCC",
  /** Base64 PNG shown while the tray is active. */
  active:
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAbUlEQVR42mN46uHLQAnGJcH51MM35KmHbzUUh0DFiDIApOHLUw/f/2j4C1QOrwGLsGhEx4twGVBNhGYYrkY3gBOHs3HhL7AwgRkQQoJmGA5BNqCaDAOqqWoAxV6gOBApjkaqJCSqJGWqZCaSMABh2/5gh+Rb1AAAAABJRU5ErkJggg==",
} as const;

/** Name of an embedded tray icon state. */
export type TrayIconName = keyof typeof TRAY_ICON_BASE64;

/** Decodes an embedded tray icon back into PNG bytes. */
export function trayIconPng(name: TrayIconName): Buffer {
  return Buffer.from(TRAY_ICON_BASE64[name], "base64");
}
