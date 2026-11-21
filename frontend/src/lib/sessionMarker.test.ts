import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BEAT_MS,
  BEAT_STALE_MS,
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
    expect(priorSessionEnd()).toBe("other-tab"); // i.e. "currently running"
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

describe("a second tab is not a crash", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a live first tab (fresh heartbeat) reads as other-tab, never unclean", () => {
    const tab1 = installSessionMarker();
    vi.advanceTimersByTime(BEAT_STALE_MS - 1); // beats keep it fresh the whole time
    expect(priorSessionEnd()).toBe("other-tab");
    tab1();
  });

  it("forced race: the same flag reads unclean once the heartbeat has stopped", () => {
    const tab1 = installSessionMarker();
    tab1(); // the tab dies without a clean close: no more beats, flag stays set
    localStorage.setItem("qz.session.active", `1@${Date.now()}`); // its last beat
    expect(priorSessionEnd()).toBe("other-tab"); // still inside the window
    vi.setSystemTime(Date.now() + BEAT_STALE_MS + 1);
    expect(priorSessionEnd()).toBe("unclean"); // window passed: a real crash
  });

  it("a sibling's clean close does not hide a still-live tab", () => {
    const tab1 = installSessionMarker();
    markSessionClean(); // another tab closed cleanly and wrote the shared flag
    expect(priorSessionEnd()).toBe("clean");
    vi.advanceTimersByTime(BEAT_MS); // tab 1's next beat re-asserts it
    expect(priorSessionEnd()).toBe("other-tab");
    tab1();
  });
});
