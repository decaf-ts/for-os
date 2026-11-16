### How to Use

- [Native bridge reference](./workdocs/8-Native-Bridges.md)
- [Initial Setup](./workdocs/tutorials/For%20Developers.md#_initial_setup_)
- [Installation](./workdocs/tutorials/For%20Developers.md#installation)
- [Scripts](./workdocs/tutorials/For%20Developers.md#scripts)
- [Testing](./workdocs/tutorials/For%20Developers.md#testing)
- [Publishing](./workdocs/tutorials/For%20Developers.md#publishing)

Install the package and build the native addon:

```bash
npm install @decaf-ts/for-os
npm run for-os:init       # Rust toolchain + platform native build deps + addon
```

Use a tray whose icon changes at runtime and whose menu calls JavaScript:

```ts
import { TrayIcon, TRAY_ICON_BASE64 } from "@decaf-ts/for-os";

const tray = TrayIcon.create({
  icon: { base64: TRAY_ICON_BASE64.idle },
  tooltip: "My application",
  menu: [
    { id: "open", label: "Open" },
    { id: "pause", label: "Pause", checkable: true },
    { separator: true, id: "sep", label: "" },
    { id: "quit", label: "Quit" },
  ],
});

tray.on("open", () => (tray.setIcon({ base64: TRAY_ICON_BASE64.active }), openWindow()));
tray.on("pause", () => tray.toggleMenuItem("pause"));
tray.on("quit", () => tray.close());
```

Send a notification that auto-dismisses and maps a button to JavaScript:

```ts
import { NotificationCenter } from "@decaf-ts/for-os";

const notifications = new NotificationCenter();
notifications
  .registerAction("accept", () => acceptAppointment())
  .registerAction("see", () => openAppointment());

notifications.notify({
  title: "New appointment",
  body: "Accept or review the appointment?",
  timeoutMs: 8_000,
  buttons: [
    { id: "accept", label: "Accept" },
    { id: "see", label: "See" },
  ],
});
```
