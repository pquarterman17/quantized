import { afterEach, describe, expect, it, vi } from "vitest";

import { frameCoalesced, observeResizePaint } from "./frameCoalesce";

describe("frameCoalesced", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("runs repeated requests once per frame and can schedule the next frame", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => (frames.push(cb), frames.length));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const callback = vi.fn();
    const scheduled = frameCoalesced(callback);

    scheduled.request();
    scheduled.request();
    scheduled.request();
    expect(frames).toHaveLength(1);
    frames.shift()?.(1);
    expect(callback).toHaveBeenCalledOnce();
    scheduled.request();
    expect(frames).toHaveLength(1);
  });

  it("cancels a queued frame", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 17));
    const cancel = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const scheduled = frameCoalesced(vi.fn());
    scheduled.request();
    scheduled.cancel();
    expect(cancel).toHaveBeenCalledWith(17);
  });
});

describe("observeResizePaint", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("disconnects its observer and cancels a queued resize paint", () => {
    let deliver: (() => void) | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(cb: () => void) { deliver = cb; }
      observe() {}
      disconnect() { disconnect(); }
    });
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 23));
    const cancel = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancel);

    const stop = observeResizePaint(document.createElement("div"), vi.fn());
    deliver?.();
    stop();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith(23);
  });
});
