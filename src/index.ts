/**
 * @module for-os
 * @description Native operating-system bridges for Decaf.ts: system tray and
 * desktop notifications, built from Rust and exposed to TypeScript/JavaScript.
 * @summary The package ships a vendored NAPI-RS crate
 * (`native/tray-icon-node`) that is compiled at install time. The TypeScript
 * layer adds runtime icon switching, menu callbacks, auto-dismiss notification
 * timers, and JavaScript button mapping on top of the raw native API. The main
 * entry points are {@link TrayIcon}, {@link NotificationCenter}, and the native
 * loader helpers exposed by {@link loadNativeModule}.
 */

export * from "./errors";
export * from "./native/types";
export * from "./native/icons";
export * from "./native/loader";
export * from "./tray/assets";
export * from "./tray/TrayIcon";
export * from "./notifications/NotificationCenter";

/**
 * @description The package version, replaced by the build pipeline.
 * @summary Reports the released semantic version of `@decaf-ts/for-os`; the
 * placeholder literal is substituted during the release build.
 * @type {string}
 * @constant
 * @memberOf module:for-os
 */
export const VERSION = "##VERSION##";
