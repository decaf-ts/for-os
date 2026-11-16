/**
 * @module for-os.errors
 * @description Error hierarchy for the native operating-system bridges.
 * @summary Every failure raised by `@decaf-ts/for-os` extends the Decaf
 * `InternalError` hierarchy so callers get a stable `code` and `name`.
 */

import { InternalError } from "@decaf-ts/db-decorators";

/**
 * @description Raised when the native tray/notification addon cannot be located or loaded.
 * @summary Use this when the vendored `tray-icon-node` addon has not been built
 * or the host platform is unsupported.
 * @param {string|Error|unknown} msg error message or originating error
 * @class NativeModuleUnavailableError
 * @extends InternalError
 * @category Errors
 */
export class NativeModuleUnavailableError extends InternalError {
  constructor(msg: string | Error | unknown) {
    super(msg, NativeModuleUnavailableError.name, 500);
  }
}

/**
 * @description Raised when a system-tray host or menu operation fails.
 * @summary Wraps native addon failures raised while creating or mutating a
 * {@link TrayIcon} so callers can distinguish tray failures from other errors.
 * @param {string|Error|unknown} msg error message or originating error
 * @class TrayError
 * @extends InternalError
 * @category Errors
 */
export class TrayError extends InternalError {
  constructor(msg: string | Error | unknown) {
    super(msg, TrayError.name, 500);
  }
}

/**
 * @description Raised when a desktop notification cannot be dispatched.
 * @summary Reserved for notification-specific failures; validation and missing
 * native backends report {@link ValidationError} and
 * {@link NativeModuleUnavailableError} respectively.
 * @param {string|Error|unknown} msg error message or originating error
 * @class NotificationError
 * @extends InternalError
 * @category Errors
 */
export class NotificationError extends InternalError {
  constructor(msg: string | Error | unknown) {
    super(msg, NotificationError.name, 500);
  }
}

/**
 * @description Raised when an icon source cannot be materialized or decoded.
 * @summary Covers empty paths, missing files, malformed base64, and RGBA buffers
 * whose length does not match `width x height x 4`.
 * @param {string|Error|unknown} msg error message or originating error
 * @class IconError
 * @extends InternalError
 * @category Errors
 */
export class IconError extends InternalError {
  constructor(msg: string | Error | unknown) {
    super(msg, IconError.name, 500);
  }
}
