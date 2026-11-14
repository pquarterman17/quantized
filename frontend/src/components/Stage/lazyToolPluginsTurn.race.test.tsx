// Bundle diet slice 27: two plot parts became lazy chunks.
//   - The tool-dock plugins (pan, cursor readout, measure, region statistics,
//     integrate, FWHM), `lib/uplotToolPlugins.ts`. The plot toolbar warms it
//     once mounted; a plot built with one of those tools before it lands must
//     rebuild when it does.
//   - The overlay half of horizontal bars, `lib/uplotTurn.ts`. Every session
//     starts loading it at startup; a turned plot built before it lands must
//     rebuild when it settles, and an upright plot never waits for it.
// This FORCES both races (docs/testing.md): each chunk import is held behind
// a gate the test opens, so "built before the chunk" is certain, not timing.

import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import type uPlot from "uplot";
import { describe, expect, it, vi } from "vitest";

import { needsToolPlugins, toolPlugins } from "../../lib/axisExtrasHook";
import type { SeriesStyle } from "../../lib/types";
import { orientPlugins, orientTurnReady } from "../../lib/uplotOrient";
import { plotDecorNeeds, useLazyPlotParts } from "./useLazyPlotParts";

const gates = vi.hoisted(() => {
  let openTools = () => {};
  let openTurn = () => {};
  const tools = new Promise<void>((r) => (openTools = r));
  const turn = new Promise<void>((r) => (openTurn = r));
  return { tools, turn, openTools: () => openTools(), openTurn: () => openTurn() };
});

vi.mock("../../lib/uplotToolPlugins", async (importOriginal) => {
  await gates.tools;
  return importOriginal();
});
vi.mock("../../lib/uplotTurn", async (importOriginal) => {
  await gates.turn;
  return importOriginal();
});

/** A viewport stand-in: counts the rebuilds `useLazyPlotParts` asks for. */
function useRebuilds(tool: string, regionResult = false, styles: SeriesStyle[] = []): number {
  const [epoch, setEpoch] = useState(0);
  const decor = plotDecorNeeds([], null, null, 0, styles);
  useLazyPlotParts([], tool, () => setEpoch((e) => e + 1), { ...decor, regionResult });
  return epoch;
}

const TURNED: SeriesStyle[] = [{ bars: "horizontal" } as SeriesStyle];
const drawHook = () => {};
const plugin = (): uPlot.Plugin => ({ hooks: { draw: drawHook } });

describe("tool plugins landing after the first build (forces the race)", () => {
  it("names the tools that need the chunk, and a drawn integral / FWHM result", () => {
    for (const tool of ["pan", "cursor", "measure", "stats", "integ", "fwhm"]) expect(needsToolPlugins(tool)).toBe(true);
    for (const tool of ["pointer", "zoom", "region", "select", "qfit"]) expect(needsToolPlugins(tool)).toBe(false);
    expect(needsToolPlugins("zoom", true)).toBe(true);
  });

  it("a plot in a plugin tool rebuilds once the chunk lands; a zoom plot never asks", async () => {
    const zoom = renderHook(() => useRebuilds("zoom"));
    const pan = renderHook(() => useRebuilds("pan"));
    const result = renderHook(() => useRebuilds("pointer", true));
    expect(toolPlugins()).toBeNull();
    expect(pan.result.current).toBe(0);

    await act(async () => {
      gates.openTools();
      await vi.waitFor(() => expect(toolPlugins()).not.toBeNull());
    });
    expect(pan.result.current).toBe(1);
    expect(result.result.current).toBe(1);
    expect(zoom.result.current).toBe(0);
    expect(typeof toolPlugins()?.panPlugin).toBe("function");

    // Loaded: a later plot in a plugin tool builds with it and needs no rebuild.
    const cursor = renderHook(() => useRebuilds("cursor"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(cursor.result.current).toBe(0);
  });
});

describe("the turn's overlay half landing after the first build (forces the race)", () => {
  it("a turned plot rebuilds once it settles; an upright plot never waits", async () => {
    expect(orientTurnReady()).toBe(false);
    // Before it lands the overlay hooks are handed back as they are.
    const before = orientPlugins([plugin()], TURNED);
    expect(before[0].hooks.draw).toBe(drawHook);
    const upright = renderHook(() => useRebuilds("zoom"));
    const turned = renderHook(() => useRebuilds("zoom", false, TURNED));

    await act(async () => {
      gates.openTurn();
      await vi.waitFor(() => expect(orientTurnReady()).toBe(true));
    });
    expect(turned.result.current).toBe(1);
    expect(upright.result.current).toBe(0);
    // Landed: the draw hook is wrapped in the upright view; upright plots are untouched.
    expect(orientPlugins([plugin()], TURNED)[0].hooks.draw).not.toBe(drawHook);
    expect(orientPlugins([plugin()], [])[0].hooks.draw).toBe(drawHook);
  });
});
