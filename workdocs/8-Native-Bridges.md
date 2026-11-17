### Native Bridges

Everything in this section is exported from `@decaf-ts/for-os`.

#### Source provenance

| Concern | Location |
| --- | --- |
| System-tray Rust crate | `native/tray-icon-node` (vendored from `nglmercer/tray-icon-node` at `cb91e86184ed8612bcdee904277b4d5e78d966c3`, package `0.1.2`) |
| OS-notification native bridge | `native/tray-icon-node/src/lib.rs` — ported from `with-ai/vendor/tray-icon-node/src/lib.rs` (`show_notification`, `show_appointment_notification`, `poll_notification_actions`) |
| with-ai JS fallback notification helper | `with-ai/src/cli/appointments/notify.ts` — **not ported**; it duplicated `osascript`/`notify-send`/PowerShell calls outside Rust, which this package deliberately centralizes in the crate |
| Source pin | `native/tray-icon-node/source-manifest.json` (SHA-512 of every source file and the canonical tree digest) |
| Build output pin | `native/tray-icon-node/build-manifest.json` (target triple, cargo/rustc versions, built binary SHA-512) |
| Build scripts | `scripts/for-os-{init,build,install,integration,integrity}.mjs`, shared in `scripts/lib/native.mjs` |
| Rust tests | `cargo test --locked --manifest-path native/tray-icon-node/Cargo.toml` (`npm run for-os:test:rust`) |

#### System tray

```ts
import { TrayIcon } from "@decaf-ts/for-os";

const tray = TrayIcon.create({
  icon: "/path/to/icon.png",        // or { base64 }, { bytes }, { png }, { rgba, width, height }
  tooltip: "My application",
  title: "my-app",                  // macOS only
  menu: [
    { id: "open", label: "Open", onClick: () => openWindow() },
    { id: "sync", label: "Sync", enabled: false },
    { id: "auto", label: "Automatic", checkable: true, checked: true },
    { separator: true, id: "sep", label: "" },
    { id: "quit", label: "Quit" },
  ],
  onEvent: (event) => console.log(event.eventType, event.x, event.y),
});

tray.on("open", () => openWindow());
tray.setIcon({ base64: activePngBase64 });   // runtime icon switching
tray.setTooltip("Working…");
tray.updateMenuItem("sync", { enabled: true, label: "Sync now" });
tray.toggleMenuItem("auto");
tray.close();
```

- `TrayIcon.create` throws `NativeModuleUnavailableError` (missing addon) or
  `TrayError` (native failure). `TrayIcon.tryCreate` returns `undefined`
  instead.
- The native event pump runs every 100 ms (`pollIntervalMs`) and is unref'd.
  `tray.poll()` drains menu events synchronously, which is useful in tests.
- `close()` is idempotent and removes the temporary icon files.
- `TRAY_ICON_BASE64.idle` / `.active` are embedded 16×16 PNG examples for
  dynamic-icon smoke checks.
- Icon decoding accepts PNG and JPEG input only; other formats are rejected as
  unsupported. Icons are limited to 4096px per side — the limit is checked on
  the encoded image header before decoding (with decoder limits as defense in
  depth) and on raw `rgba` dimensions, so oversized or zero-dimension icons
  fail with a dimension error instead of allocating memory for them.

#### Notifications

```ts
import { NotificationCenter } from "@decaf-ts/for-os";

const center = new NotificationCenter();
center.registerAction("accept", () => acceptAppointment());

const notification = center.notify({
  title: "New appointment",
  body: "Accept or review the appointment?",
  timeoutMs: 8_000,                 // 0 disables the timer
  buttons: [
    { id: "accept", label: "Accept" },
    { id: "see", label: "See", onClick: () => openAppointment() },
  ],
  onDismiss: (reason) => console.log("dismissed", reason),
});

notification.onAction((id) => console.log("callback handled", id));
```

- `timeoutMs` is passed to the native notification service. Linux
  (`notify-send --expire-time`) and Windows (balloon-tip timeout) honour it;
  macOS applies its system dismissal policy. The bridge also tracks the timer
  locally so `onDismiss("timer")` always fires at the configured time.
- `dismiss()` marks the notification dismissed and reports `"manual"`. There is
  no portable API to close an already-visible OS notification, so this is
  bookkeeping, not a remote control.
- Action buttons are native on Linux. `notify-send --wait` blocks a Rust
  worker thread and the activated button id is queued to
  `pollNotificationActions()`. macOS and Windows show a plain notification;
  put equivalent actions in the tray menu there.
- The action id returned by the service is matched against global
  `registerAction` handlers, the notification's `onAction`, and each button's
  `onClick`, in that order. An id that matches no live notification only reaches
  global handlers; it never falls through to the most recent notification's
  callbacks. The reserved `default` body-click id maps to the first button of the
  notification that owns it.
- A notification is pruned from the centre's records when it is dismissed
  (`timeoutMs` timer or `dismiss()`), so its handlers no longer resolve.
- `notifyAppointment` uses the native Accept/See action set and normalizes the
  service's reserved `default` action to `see`.

#### Platform support

| Feature | Linux | macOS | Windows |
| --- | --- | --- | --- |
| Tray icon, tooltip, title, menu, events | yes | yes | yes |
| Runtime icon switching | yes | yes | yes |
| Notification title/body | yes (`notify-send`) | yes (`osascript`) | yes (PowerShell balloon) |
| Notification auto-dismiss timer | yes | system default | yes |
| Notification action buttons → JS | yes (`notify-send --wait`) | no | no |

The npm package bundles Linux x64/ARM64 (glibc), macOS x64/ARM64, and Windows
x64/x86 binaries. Linux musl and Windows ARM64 are not release targets.

#### Scripts

| Script | Purpose |
| --- | --- |
| `npm run for-os:init` | Install the pinned Rust toolchain (1.100.0, bootstrapped with a checksum-verified rustup-init) + Linux native build libraries (or report the exact manual commands where installation is not permitted), then build and materialize the addon |
| `npm run for-os:init:check` | Report host readiness without mutating anything |
| `npm run for-os:build` | `cargo build --release --locked` from the pinned source and write `build-manifest.json` |
| `npm run for-os:build:check` | Verify the source pin and report the existing build |
| `npm run for-os:install` | Materialize the bundled addon; build from source as a fallback |
| `npm run for-os:install:required` | Same, but fail when the native build cannot run |
| `npm run for-os:package:check` | Verify that all release target binaries are present |
| `npm run for-os:integrity:record` | Re-pin the native source tree (security-relevant; review the diff) |
| `npm run for-os:integrity:check` | Verify the source tree against the pin |
| `npm run for-os:test:rust` | Rust unit tests (notification argument/timer/action contract and tray conversions) |
| `npm run for-os:integration` | Interactive real-tray check: runtime icon switch, notification button, menu actions |
| `npm run for-os:smoke` | Non-interactive tray create → icon switch → timed notification → close |
| `npm run for-os:buttons` | Sends an actionable notification and waits for a JavaScript button callback |

`postinstall` runs `scripts/for-os-install.mjs` and materializes the matching
bundled addon under the package and, when npm reports an `INIT_CWD`, under that
project's `node_modules` as well. It attempts a local Rust build only if the
matching prebuilt binary is absent. The loader searches the current directory,
`INIT_CWD`, and the Node entrypoint's directory, and `FOR_OS_NATIVE_MODULE` can
pin an explicit path.

To exercise button mapping on a headless Linux host, run the integration check
with a notification daemon and trigger the notification body (the default
action is aliased to the first caller button):

```bash
dbus-run-session -- xvfb-run -a bash -c '\
  dunst & sleep 2; (sleep 2; dunstctl action 0) & \
  npm run for-os:buttons'
```

#### Continuous integration

This repository owns two workflows for its standalone CI:

- `for-os-native` builds and smoke-checks the Linux tray and notification
  addon on relevant pushes and pull requests, plus manual dispatch.
- `rust-audit` scans `native/tray-icon-node/Cargo.lock` against the RustSec
  advisory database on crate changes, weekly, and on demand. Vulnerabilities
  at/above low severity fail the job; unmaintained/unsound/notice advisories
  are report-only (`.github/rust-audit/audit.toml`).

These workflows run against this repository directly; they do not depend on a
copy in the umbrella repository.

#### Prerequisites

- Node.js >= 20 and npm >= 10.
- Pinned Rust toolchain 1.100.0 (`rustup`, `cargo`, `rustc`). A missing
  toolchain is bootstrapped by `for-os:init` with rustup-init 1.29.3,
  downloaded from the versioned rustup archive and verified against a
  hard-coded SHA-256 before execution — the installer is never piped from the
  network into a shell.
- Linux (Ubuntu/Debian): `build-essential pkg-config libgtk-3-dev
  libayatana-appindicator3-dev libglib2.0-dev libxdo-dev libx11-dev
  libnotify-bin`.
- macOS: Xcode command-line tools (`xcode-select --install`).
- Windows: Visual Studio Build Tools with **Desktop development with C++** and
  the MSVC Rust host toolchain.
- A graphical desktop session with a system-tray host and notification service
  for the real integration check. `--smoke` still needs a tray host and a
  notification daemon (for example `xvfb-run` plus `dunst`).

#### Security and integrity

- Release binaries are built from the audited source tree on target-matched
  runners; no third-party prebuilt addon is downloaded.
- `source-manifest.json` pins every source/wrapper file by SHA-512 and the
  canonical source digest. Every build script verifies it before compiling.
- `build-manifest.json` records the source digest, target triple, toolchain
  versions, and binary SHA-512; a build is reused only when all still match.
- The crate performs no network access, no environment reads, and no dynamic
  code loading. `unsafe` is confined to the upstream Win32 message-loop pump
  and the documented tray-icon handle `Send`/`Sync` impls.
- Notification text is passed to host commands as argument vectors, never
  through a shell; AppleScript and PowerShell values are escaped in Rust.
  `notify-send` arguments end option parsing with `--` before the title and body,
  so leading-dash text is delivered literally.
- Caller-supplied icon extensions are sanitized to an alphanumeric/dot suffix
  (capped at 16 characters) before the icon is materialized, and the resolved
  path is checked to stay inside the private icon directory.

#### Published package layout

- `files` publishes the compiled output `lib` (ESM at
  `lib/esm`, CommonJS at `lib/cjs`, declarations at `lib/types`), the
  `native/tray-icon-node` Rust sources (Cargo manifest and lockfile plus the
  NAPI-RS loader `index.js`/`index.d.ts`, all supported `.node` binaries, and
  their SHA-512 manifest), and the `scripts/` folder that `postinstall` runs.
  The release workflow builds each target on a matching runner, combines the
  binaries, and blocks publication if any target is missing.
- `exports` maps `.` to both module systems: ESM at `./lib/esm/index.js`
  with types `./lib/types/index.d.mts`, and CommonJS at `./lib/cjs/index.cjs`
  with types `./lib/types/index.d.cts`. `main`, `module`, and `types` mirror
  the same entry points.

#### Publishing and credential gates

- Publishing builds target binaries then publishes with npm trusted publishing.
- Release builds need the Rust toolchain and crates.io access; `Cargo.lock`
  pins the full crate closure. Consumers receive the compiled addon and do not
  need Rust or a native compiler. Linux runtime hosts still need GTK and
  AppIndicator runtime libraries, plus `notify-send` for notifications.
