import { ValidationError } from "@decaf-ts/db-decorators";
import { NativeModuleUnavailableError } from "../../src/errors";
import { loadNativeModule } from "../../src/native/loader";
import {
  DEFAULT_NOTIFICATION_TIMEOUT_MS,
  NotificationCenter,
  notify,
  type NotifyOptions,
} from "../../src/notifications/NotificationCenter";
import { createFakeNative } from "../fake-native";

describe("NotificationCenter", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("dispatches buttons and timeout to the native module and maps an action to JS", () => {
    const api = createFakeNative();
    const center = new NotificationCenter({ api });
    const seen: Array<{ action: string; id?: string }> = [];
    center.registerAction("accept", (action, notification) =>
      seen.push({ action, id: notification?.id })
    );

    const notification = center.notify({
      title: "Appointment",
      body: "Accept the appointment?",
      timeoutMs: 5_000,
      buttons: [
        {
          id: "accept",
          label: "Accept",
          onClick: (action) => seen.push({ action }),
        },
        { id: "see", label: "See" },
      ],
    });

    expect(notification.delivered).toBe(true);
    const call = api.calls.notifications[0];
    expect(call.actions).toEqual([
      { id: "accept", label: "Accept" },
      { id: "see", label: "See" },
    ]);
    expect(call.timeoutMs).toBe(5_000);

    api.queueNotificationAction("accept");
    expect(center.pollActions()).toEqual(["accept"]);
    expect(seen).toEqual([
      { action: "accept", id: notification.id },
      { action: "accept" },
    ]);

    center.close();
  });

  it("tracks the auto-dismiss timer and reports the dismissal reason", () => {
    jest.useFakeTimers();
    const api = createFakeNative();
    const center = new NotificationCenter({ api });
    const dismissals: string[] = [];

    const notification = center.notify({
      title: "Timed",
      body: "This disappears.",
      timeoutMs: 1_000,
      onDismiss: (reason) => dismissals.push(reason),
    });
    expect(notification.dismissed).toBe(false);

    jest.advanceTimersByTime(1_000);
    expect(notification.dismissed).toBe(true);
    expect(dismissals).toEqual(["timer"]);

    center.close();
  });

  it("supports manual dismissal, appointment notifications, and a disabled timer", () => {
    jest.useFakeTimers();
    const api = createFakeNative();
    const center = new NotificationCenter({ api });
    const reasons: string[] = [];

    const timersBefore = jest.getTimerCount();
    const appointment = center.notifyAppointment({
      title: "Appointment",
      body: "Accept or see.",
      timeoutMs: 0,
      onDismiss: (reason) => reasons.push(reason),
    });
    expect(api.calls.notifications[0].appointment).toBe(true);
    expect(appointment.buttons.map((button) => button.id)).toEqual(["accept", "see"]);
    expect(jest.getTimerCount()).toBe(timersBefore + 1);

    jest.advanceTimersByTime(DEFAULT_NOTIFICATION_TIMEOUT_MS * 2);
    expect(appointment.dismissed).toBe(false);
    expect(reasons).toEqual([]);

    appointment.dismiss();
    appointment.dismiss();
    expect(reasons).toEqual(["manual"]);
    expect(appointment.dismissed).toBe(true);

    center.close();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("rejects invalid notification options", () => {
    const center = new NotificationCenter({ api: createFakeNative() });
    expect(() => center.notify(null as unknown as NotifyOptions)).toThrow(ValidationError);
    expect(() => center.notify({ title: "", body: "x" })).toThrow(ValidationError);
    expect(() => center.notify({ title: "x", body: "   " })).toThrow(ValidationError);
    expect(() => center.notify({ title: "x", body: "y", timeoutMs: -1 })).toThrow(
      ValidationError
    );
    expect(() => center.notify({ title: "x", body: "y", timeoutMs: Number.NaN })).toThrow(
      ValidationError
    );
    expect(() =>
      center.notify({
        title: "x",
        body: "y",
        buttons: [{ id: "", label: "" }],
      })
    ).toThrow(ValidationError);
    expect(() =>
      center.notify({
        title: "x",
        body: "y",
        buttons: [
          { id: "a", label: "A" },
          { id: "a", label: "Again" },
        ],
      })
    ).toThrow(ValidationError);
    center.close();
  });

  it("reports native availability and refuses to send once closed", () => {
    const api = createFakeNative();
    const center = new NotificationCenter({ api });
    expect(center.available).toBe(true);

    const noApi = new NotificationCenter();
    expect(noApi.available).toBe(loadNativeModule().available);
    noApi.close();

    center.close();
    center.close();
    expect(() => center.notify({ title: "x", body: "y" })).toThrow(NativeModuleUnavailableError);
  });

  it("falls back to plain notifications when native action buttons are unavailable", () => {
    const api = createFakeNative();
    api.showNotificationWithActions = undefined;
    const center = new NotificationCenter({ api });
    try {
      const notification = center.notify({
        title: "Plain",
        body: "No native buttons.",
        timeoutMs: 0,
        buttons: [{ id: "accept", label: "Accept" }],
      });
      expect(notification.delivered).toBe(true);
      expect(api.calls.notifications[0].actions).toBeUndefined();
      expect(api.calls.notifications[0].timeoutMs).toBeUndefined();
    } finally {
      center.close();
    }
  });

  it("falls back to a button notification when appointment delivery is unavailable", () => {
    const api = createFakeNative();
    api.showAppointmentNotification = undefined;
    const center = new NotificationCenter({ api });
    try {
      const notification = center.notifyAppointment({
        title: "Appointment",
        body: "Accept or see.",
        timeoutMs: 0,
      });
      expect(api.calls.notifications[0].appointment).toBeUndefined();
      expect(api.calls.notifications[0].actions?.map((action) => action.id)).toEqual([
        "accept",
        "see",
      ]);
      expect(notification.buttons.map((button) => button.id)).toEqual(["accept", "see"]);
    } finally {
      center.close();
    }
  });

  it("removes a failed notification and surfaces the native error", () => {
    const api = createFakeNative();
    api.showNotification = () => {
      throw new Error("native down");
    };
    api.showAppointmentNotification = () => {
      throw new Error("appointment down");
    };
    const center = new NotificationCenter({ api });
    try {
      expect(() => center.notify({ title: "x", body: "y", timeoutMs: 0 })).toThrow("native down");
      expect(() => center.notifyAppointment({ title: "x", body: "y", timeoutMs: 0 })).toThrow(
        "appointment down"
      );
    } finally {
      center.close();
    }
  });

  it("routes unknown actions only to global handlers and logs handler failures", () => {
    const api = createFakeNative();
    const log: string[] = [];
    const center = new NotificationCenter({ api, log: (message) => log.push(message) });
    try {
      center.notify({ title: "one", body: "first", timeoutMs: 0 });
      center.notify({ title: "two", body: "second", timeoutMs: 0 });

      const seen: Array<string | undefined> = [];
      center.registerAction("orphan", (_action, notification) => seen.push(notification?.id));
      api.queueNotificationAction("orphan");
      expect(center.pollActions()).toEqual(["orphan"]);
      expect(seen).toEqual([undefined]);

      center.registerAction("boom", () => {
        throw new Error("global handler down");
      });
      api.queueNotificationAction("boom");
      expect(center.pollActions()).toEqual(["boom"]);
      expect(log.join(" ")).toContain('action "boom" handler failed');

      center.notify({
        title: "three",
        body: "third",
        timeoutMs: 0,
        onAction: () => {
          throw new Error("record handler down");
        },
        buttons: [
          {
            id: "act",
            label: "Act",
            onClick: () => {
              throw new Error("button handler down");
            },
          },
        ],
      });
      api.queueNotificationAction("act");
      expect(center.pollActions()).toEqual(["act"]);
      expect(log.filter((message) => message.includes('action "act" handler failed'))).toHaveLength(
        2
      );
    } finally {
      center.close();
    }
  });

  it("maps the reserved default id to the latest record's first button", () => {
    const api = createFakeNative();
    const center = new NotificationCenter({ api });
    const seen: string[] = [];
    try {
      center
        .notify({
          title: "first",
          body: "first body",
          timeoutMs: 0,
          onAction: (action) => seen.push(`first-action:${action}`),
          buttons: [
            {
              id: "first-action",
              label: "First",
              onClick: (action) => seen.push(`first-click:${action}`),
            },
          ],
        });
      center.notify({
        title: "second",
        body: "second body",
        timeoutMs: 0,
        onAction: (action) => seen.push(`second-action:${action}`),
        buttons: [
          { id: "accept", label: "Accept", onClick: (action) => seen.push(`second-click:${action}`) },
          { id: "see", label: "See", onClick: (action) => seen.push(`second-see:${action}`) },
        ],
      });

      api.queueNotificationAction("default");
      expect(center.pollActions()).toEqual(["default"]);
      expect(seen).toEqual(["second-action:accept", "second-click:accept"]);
    } finally {
      center.close();
    }
  });

  it("stops resolving dismissed records for later action dispatch", () => {
    jest.useFakeTimers();
    const api = createFakeNative();
    const center = new NotificationCenter({ api });
    const recordHits: string[] = [];
    const globalHits: Array<string | undefined> = [];
    try {
      center.registerAction("act", (_action, notification) => globalHits.push(notification?.id));

      const manual = center.notify({
        title: "manual",
        body: "dismiss me",
        timeoutMs: 0,
        onAction: (action) => recordHits.push(`manual-action:${action}`),
        buttons: [
          { id: "act", label: "Act", onClick: (action) => recordHits.push(`manual-click:${action}`) },
        ],
      });
      manual.dismiss();
      api.queueNotificationAction("act");
      expect(center.pollActions()).toEqual(["act"]);
      expect(recordHits).toEqual([]);
      expect(globalHits).toEqual([undefined]);

      const timed = center.notify({
        title: "timed",
        body: "expire eventually",
        timeoutMs: 1_000,
        onAction: (action) => recordHits.push(`timed-action:${action}`),
        buttons: [
          { id: "act", label: "Act", onClick: (action) => recordHits.push(`timed-click:${action}`) },
        ],
      });
      jest.advanceTimersByTime(1_000);
      expect(timed.dismissed).toBe(true);
      api.queueNotificationAction("act");
      expect(center.pollActions()).toEqual(["act"]);
      expect(recordHits).toEqual([]);
      expect(globalHits).toEqual([undefined, undefined]);
    } finally {
      center.close();
    }
  });

  it("handles an empty record set and logs action poll failures", () => {
    const bareApi = createFakeNative();
    const bare = new NotificationCenter({ api: bareApi });
    try {
      const seen: Array<string | undefined> = [];
      bare.registerAction("idle", (_action, notification) => seen.push(notification?.id));
      bareApi.queueNotificationAction("idle");
      expect(bare.pollActions()).toEqual(["idle"]);
      expect(seen).toEqual([undefined]);
    } finally {
      bare.close();
    }

    const failingApi = createFakeNative();
    failingApi.pollNotificationActions = () => {
      throw new Error("poll down");
    };
    const log: string[] = [];
    const failing = new NotificationCenter({ api: failingApi, log: (message) => log.push(message) });
    try {
      expect(failing.pollActions()).toEqual([]);
      expect(log.join(" ")).toContain("action poll failed");
    } finally {
      failing.close();
    }
  });

  it("unregisters global action handlers", () => {
    const api = createFakeNative();
    const center = new NotificationCenter({ api });
    const seen: string[] = [];
    const handler = (action: string) => seen.push(action);
    try {
      center.registerAction("ping", handler);
      center.unregisterAction("ping", handler);
      center.unregisterAction("missing", handler);
      api.queueNotificationAction("ping");
      expect(center.pollActions()).toEqual(["ping"]);
      expect(seen).toEqual([]);
    } finally {
      center.close();
    }
  });

  it("keeps a throwing dismiss handler from breaking the timer", () => {
    jest.useFakeTimers();
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const api = createFakeNative();
    const center = new NotificationCenter({ api });
    try {
      const notification = center.notify({
        title: "Timed",
        body: "Dismiss handler fails.",
        timeoutMs: 50,
        onDismiss: () => {
          throw new Error("dismiss down");
        },
      });
      jest.advanceTimersByTime(50);
      expect(notification.dismissed).toBe(true);
    } finally {
      center.close();
      warn.mockRestore();
    }
  });

  it("exports a one-shot notify helper that validates options", () => {
    expect(() => notify({ title: "", body: "" })).toThrow(ValidationError);
  });
});
