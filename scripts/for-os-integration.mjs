#!/usr/bin/env node
/**
 * Real native integration check for the built addon and TypeScript bridges.
 *
 * `--smoke` creates a tray, switches its icon at runtime, updates the tooltip,
 * sends a timed notification, and closes the tray. The default interactive
 * mode additionally waits for menu actions and notification buttons.
 * @module scripts/for-os-integration
 */
const process = globalThis.process;
const importModule = new Function("specifier", "return import(specifier);");

const smokeOnly = process.argv.includes("--smoke");
const buttonsOnly = process.argv.includes("--buttons");
const timeoutMs = Number(process.env.FOR_OS_TRAY_TEST_TIMEOUT_MS || 90_000);
const libPath = new URL("../lib/esm/index.js", import.meta.url).href;

const actions = [];
let tray;
let center;
let wake;

function waitForAction(expected) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      const index = actions.indexOf(expected);
      if (index >= 0) {
        actions.splice(index, 1);
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(`Timed out waiting for tray action "${expected}".`));
        return;
      }
      wake = setTimeout(poll, 100);
    };
    poll();
  });
}

async function main() {
  const { TrayIcon, NotificationCenter, TRAY_ICON_BASE64 } = await importModule(libPath);
  tray = TrayIcon.create({
    icon: { base64: TRAY_ICON_BASE64.idle },
    tooltip: "for-os integration check",
    menu: [
      { id: "search", label: "Search now" },
      { id: "accept", label: "Accept appointment" },
      { id: "auto", label: "Auto toggle", checkable: true, checked: false },
      { id: "quit", label: "Quit" },
    ],
    onEvent: (event) => console.log(`tray event: ${event.eventType}`),
  });
  for (const id of ["search", "accept", "quit"]) {
    tray.on(id, (action) => actions.push(action));
  }
  center = new NotificationCenter();
  center.registerAction("accept", (action) => actions.push(action));

  // Runtime icon switching: idle -> active -> idle.
  tray.setIcon({ base64: TRAY_ICON_BASE64.active });
  tray.setTooltip("for-os integration check: active");
  tray.setIcon({ base64: TRAY_ICON_BASE64.idle });
  tray.updateMenuItem("accept", { enabled: true });
  console.log("PASS: native tray created and its icon switched at runtime.");

  // Checkable menu toggling against the real addon: false -> true -> false.
  const autoInitial = tray.isMenuItemChecked("auto");
  const autoFirst = tray.toggleMenuItem("auto");
  const autoFirstRead = tray.isMenuItemChecked("auto");
  const autoSecond = tray.toggleMenuItem("auto");
  const autoSecondRead = tray.isMenuItemChecked("auto");
  if (
    autoInitial !== false ||
    autoFirst !== true ||
    autoFirstRead !== true ||
    autoSecond !== false ||
    autoSecondRead !== false
  ) {
    throw new Error(
      "toggleMenuItem regression: expected checked state false -> true -> false, " +
        `got initial=${autoInitial} toggle1=${autoFirst}/${autoFirstRead} toggle2=${autoSecond}/${autoSecondRead}.`
    );
  }
  console.log("PASS: checkable menu item toggled false -> true -> false.");

  if (smokeOnly) {
    const notification = center.notify({
      title: "for-os tray test",
      body: "Rust delivered this timed notification through the operating system.",
      timeoutMs: 3_000,
    });
    console.log(`PASS: timed notification dispatched (${notification.id}).`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    console.log("PASS: native tray smoke check complete.");
    return;
  }

  const notification = center.notify({
    title: "for-os button mapping",
    body: "Activate a button to prove the native action reaches a JavaScript callback.",
    timeoutMs,
    buttons: [
      { id: "accept", label: "Accept appointment" },
      { id: "see", label: "See appointment" },
    ],
  });
  console.log(`Notification ${notification.id} sent. Activate "Accept appointment".`);
  await waitForAction("accept");
  console.log("PASS: native notification button reached its JavaScript callback.");
  if (buttonsOnly) return;

  for (const step of [
    { id: "search", instruction: "choose “Search now”" },
    { id: "accept", instruction: "choose “Accept appointment”" },
    { id: "quit", instruction: "choose “Quit”" },
  ]) {
    console.log(`Step: open the tray menu and ${step.instruction}.`);
    await waitForAction(step.id);
    console.log(`PASS: tray menu action "${step.id}" reached JavaScript.`);
  }
  console.log("PASS: for-os tray, dynamic icons, notification timers, and JS buttons are integrated.");
}

try {
  await main();
  process.exitCode = 0;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (wake) clearTimeout(wake);
  center?.close();
  tray?.close();
}
