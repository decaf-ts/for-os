import {
  IconError,
  NativeModuleUnavailableError,
  NotificationError,
  TrayError,
} from "../../src/errors";

type BridgeErrorClass = new (msg: string | Error | unknown) => Error & { code: number };

describe("for-os errors", () => {
  const cases: BridgeErrorClass[] = [
    NativeModuleUnavailableError,
    TrayError,
    NotificationError,
    IconError,
  ];

  it("keeps the Decaf internal error code for every bridge error", () => {
    for (const ErrorClass of cases) {
      const error = new ErrorClass("boom");
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ErrorClass);
      expect(error.code).toBe(500);
      expect(error.message).toContain("boom");
      expect(error.message.length).toBeGreaterThan(0);
    }
  });

  it("wraps Error payloads without losing their message", () => {
    const error = new TrayError(new Error("native inner failure"));
    expect(error).toBeInstanceOf(TrayError);
    expect(error.code).toBe(500);
    expect(error.message).toContain("native inner failure");
  });
});
