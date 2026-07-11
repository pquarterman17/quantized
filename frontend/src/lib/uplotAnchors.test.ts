// anchorEditPlugin's gesture contract, driven through jsdom mouse events on a
// stubbed uPlot (`fakeU` idiom, extended with an `over` element + redraw spy).
// The pure pixel/hit-test cases that used to live here moved to
// pointGesture.test.ts with the shared core (MAIN #8); what this file now
// guards is the plugin's OWN behaviour: click-add / click-remove / drag-move
// commits, the #8f getter-freshness contract (the plugin sees anchor-list
// changes WITHOUT being rebuilt), and the #8f per-scale pixel cache.

import { afterEach, describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";

import { anchorEditPlugin, type AnchorPoint } from "./uplotAnchors";

function makeU() {
  const over = document.createElement("div");
  document.body.appendChild(over);
  const valToPos = vi.fn((v: number) => v); // 1:1 data↔px; over's rect is (0,0) in jsdom
  const u = {
    over,
    scales: { x: { min: 0, max: 100 }, y: { min: 0, max: 100 } },
    valToPos,
    posToVal: (v: number) => v,
    redraw: vi.fn(),
    bbox: { left: 0, top: 0, width: 100, height: 100 },
  } as unknown as uPlot;
  return { u, over, valToPos };
}

function ready(plugin: uPlot.Plugin, u: uPlot) {
  (plugin.hooks.ready as (u: uPlot) => void)(u);
}

const mouse = (type: string, x: number, y: number) =>
  new MouseEvent(type, { clientX: x, clientY: y, button: 0 });

afterEach(() => {
  document.body.innerHTML = "";
});

describe("anchorEditPlugin", () => {
  it("click on empty canvas commits onAdd at the clicked data coords", () => {
    const { u, over } = makeU();
    const onAdd = vi.fn();
    const plugin = anchorEditPlugin(() => [], {
      onAdd,
      onMove: vi.fn(),
      onRemove: vi.fn(),
      color: "#000",
    });
    ready(plugin, u);

    over.dispatchEvent(mouse("mousedown", 50, 40));
    document.dispatchEvent(mouse("mouseup", 51, 40)); // < CLICK_PX travel
    expect(onAdd).toHaveBeenCalledWith(51, 40);
  });

  it("a drag from empty canvas (≥ CLICK_PX) is NOT an add — zoom/pan pass through", () => {
    const { u, over } = makeU();
    const onAdd = vi.fn();
    const plugin = anchorEditPlugin(() => [], {
      onAdd,
      onMove: vi.fn(),
      onRemove: vi.fn(),
      color: "#000",
    });
    ready(plugin, u);

    over.dispatchEvent(mouse("mousedown", 50, 40));
    document.dispatchEvent(mouse("mouseup", 70, 40));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("click on a marker commits onRemove with the anchor's index", () => {
    const { u, over } = makeU();
    const onRemove = vi.fn();
    const plugin = anchorEditPlugin(() => [{ index: 3, x: 50, y: 50 }], {
      onAdd: vi.fn(),
      onMove: vi.fn(),
      onRemove,
      color: "#000",
    });
    ready(plugin, u);

    over.dispatchEvent(mouse("mousedown", 52, 50)); // within tol=8 of the marker
    document.dispatchEvent(mouse("mouseup", 52, 50));
    expect(onRemove).toHaveBeenCalledWith(3);
  });

  it("dragging a marker commits onMove ONCE with the release data coords", () => {
    const { u, over } = makeU();
    const onMove = vi.fn();
    const onRemove = vi.fn();
    const plugin = anchorEditPlugin(() => [{ index: 0, x: 50, y: 50 }], {
      onAdd: vi.fn(),
      onMove,
      onRemove,
      color: "#000",
    });
    ready(plugin, u);

    over.dispatchEvent(mouse("mousedown", 50, 50));
    document.dispatchEvent(mouse("mousemove", 60, 55));
    document.dispatchEvent(mouse("mousemove", 70, 58));
    document.dispatchEvent(mouse("mouseup", 70, 58));
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith(0, 70, 58);
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("#8f: reads the anchor list through the getter — list changes are seen without a plugin rebuild", () => {
    const { u, over } = makeU();
    let anchors: AnchorPoint[] = [];
    const onAdd = vi.fn((x: number, y: number) => {
      anchors = [...anchors, { index: anchors.length, x, y }];
    });
    const onRemove = vi.fn();
    const plugin = anchorEditPlugin(() => anchors, {
      onAdd,
      onMove: vi.fn(),
      onRemove,
      color: "#000",
    });
    ready(plugin, u);

    // add at (30, 30) …
    over.dispatchEvent(mouse("mousedown", 30, 30));
    document.dispatchEvent(mouse("mouseup", 30, 30));
    expect(onAdd).toHaveBeenCalledWith(30, 30);
    // … then a click at the SAME spot hits the freshly-added marker: the
    // plugin saw the new list through the getter, no rebuild involved.
    over.dispatchEvent(mouse("mousedown", 31, 30));
    document.dispatchEvent(mouse("mouseup", 31, 30));
    expect(onRemove).toHaveBeenCalledWith(0);
  });

  it("#8f: pixel positions are cached per anchor-list identity + scale window", () => {
    const { u, over, valToPos } = makeU();
    const anchors: AnchorPoint[] = [{ index: 0, x: 10, y: 10 }];
    const plugin = anchorEditPlugin(() => anchors, {
      onAdd: vi.fn(),
      onMove: vi.fn(),
      onRemove: vi.fn(),
      color: "#000",
    });
    ready(plugin, u);

    over.dispatchEvent(mouse("mousemove", 90, 90));
    const afterFirst = valToPos.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);
    // same list, same scales → the second move reuses the cached pixels
    over.dispatchEvent(mouse("mousemove", 91, 91));
    expect(valToPos.mock.calls.length).toBe(afterFirst);
    // scale window change → cache invalidates and pixels recompute
    (u.scales.x as { max: number | undefined }).max = 200;
    over.dispatchEvent(mouse("mousemove", 92, 92));
    expect(valToPos.mock.calls.length).toBeGreaterThan(afterFirst);
  });
});
