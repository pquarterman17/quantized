import { beforeEach, describe, expect, it } from "vitest";

import {
  installSessionMarker,
  markSessionActive,
  markSessionClean,
  priorSessionEnd,
} from "./sessionMarker";

beforeEach(() => localStorage.clear());

describe("priorSessionEnd", () => {
  it("reports first-run when nothing was ever written", () => {
    expect(priorSessionEnd()).toBe("first-run");
  });

  it("reports clean after a session that marked itself clean", () => {
    markSessionActive();
    markSessionClean();
    expect(priorSessionEnd()).toBe("clean");
  });

  it("reports unclean when the flag is still set — the crash case", () => {
    // A session that never got to run its unload handler leaves "1" behind.
    markSessionActive();
    expect(priorSessionEnd()).toBe("unclean");
  });

  it("never claims a crash when storage is unreadable", () => {
    // Erring toward under-reporting is deliberate: a false crash notice is
    // worse than a missed one.
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    expect(priorSessionEnd()).toBe("first-run");
    if (original) Object.defineProperty(window, "localStorage", original);
  });
});

describe("installSessionMarker", () => {
  it("marks the session active immediately", () => {
    const teardown = installSessionMarker();
    expect(priorSessionEnd()).toBe("unclean"); // i.e. "currently running"
    teardown();
  });

  it("marks clean on pagehide", () => {
    const teardown = installSessionMarker();
    window.dispatchEvent(new Event("pagehide"));
    expect(priorSessionEnd()).toBe("clean");
    teardown();
  });

  it("marks clean on beforeunload", () => {
    // Both are registered: beforeunload is unreliable on mobile and when a tab
    // is discarded, pagehide is the modern replacement.
    const teardown = installSessionMarker();
    window.dispatchEvent(new Event("beforeunload"));
    expect(priorSessionEnd()).toBe("clean");
    teardown();
  });

  it("stops responding after teardown", () => {
    const teardown = installSessionMarker();
    teardown();
    markSessionActive();
    window.dispatchEvent(new Event("pagehide"));
    expect(priorSessionEnd()).toBe("unclean");
  });
});
