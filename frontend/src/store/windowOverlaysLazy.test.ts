// Review #11: a failed fetch of the lazy fold / handoff chunk is retried by the
// next `overlaysNow()` miss -- not only by the next project load.
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("./windowOverlays");
  vi.resetModules();
});

describe("windowOverlaysLazy", () => {
  it("retries after a failed load, on the next overlaysNow miss", async () => {
    vi.resetModules();
    let fail = true;
    vi.doMock("./windowOverlays", async (importOriginal) => {
      if (fail) throw new Error("chunk failed to load");
      return importOriginal();
    });
    const lazy = await import("./windowOverlaysLazy");
    await expect(lazy.loadWindowOverlays()).rejects.toThrow();
    expect(lazy.overlaysNow()).toBeNull(); // the miss starts a new fetch
    fail = false;
    await vi.waitFor(() => expect(lazy.overlaysNow()).not.toBeNull());
    expect(typeof lazy.overlaysNow()!.handoff).toBe("function");
  });
});
