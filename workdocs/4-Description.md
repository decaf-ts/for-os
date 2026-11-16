### Description

`@decaf-ts/for-os` gives Node.js and TypeScript applications a small,
auditable bridge to the desktop:

- **System tray** — icon, tooltip, macOS title, and a menu whose entries call
  JavaScript handlers. The icon can be replaced at runtime from a file path,
  base64 string, byte buffer, or raw RGBA pixels.
- **Desktop notifications** — title/body, an auto-dismiss timer, and action
  buttons mapped to JavaScript callbacks. Button delivery is native on Linux
  (`notify-send --wait`); macOS and Windows render a plain notification.
- **Rust core** — the `native/tray-icon-node` crate is a vendored copy of
  [`nglmercer/tray-icon-node`](https://github.com/nglmercer/tray-icon-node) at
  commit `cb91e86184ed8612bcdee904277b4d5e78d966c3`, extended with the
  notification-action bridge, notification timers, and configurable buttons.
  It is built from the pinned source at install time; no prebuilt binary is
  downloaded.

The TypeScript layer never shells out to `notify-send` or PowerShell itself:
all OS commands live in the Rust crate, and every failure is reported through
the Decaf error hierarchy.
