import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";

import type { ErrorBinding } from "./errorRoles";
import {
  DECIMATE_MIN_POINTS,
  bucketsForWidth,
  buildDecimatedData,
  decimatePlugin,
  decimateRowIndices,
  decimationEligible,
  decimationRequestEligible,
  defaultDecimateWidthHint,
  errorBindingsApplyToPlotted,
  hasErrorMapEntries,
  shouldDecimate,
  shouldRefetchWindow,
  visibleRowRange,
  xExtent,
} from "./plotDecimate";

describe("shouldDecimate", () => {
  it("never engages at or below the 10k-row floor, regardless of width", () => {
    expect(shouldDecimate(DECIMATE_MIN_POINTS, 100)).toBe(false); // exactly at the floor
    expect(shouldDecimate(DECIMATE_MIN_POINTS - 1, 10)).toBe(false); // narrow width, still under floor
  });

  it("does not engage above the floor when density is still below threshold", () => {
    // 20,000 points over a 10,000px-wide plot is 2 pts/px — under the 4 pts/px bar.
    expect(shouldDecimate(20_000, 10_000)).toBe(false);
  });

  it("engages once both the floor and the density threshold are cleared", () => {
    // 1,000,000 points over 1,000px is 1,000 pts/px — well past 4.
    expect(shouldDecimate(1_000_000, 1_000)).toBe(true);
  });

  it("treats a zero/negative width as never engaging (guards a divide-by-zero)", () => {
    expect(shouldDecimate(1_000_000, 0)).toBe(false);
  });
});

describe("bucketsForWidth", () => {
  it("is at least 1 bucket even for a near-zero width", () => {
    expect(bucketsForWidth(0.2)).toBeGreaterThanOrEqual(1);
  });

  it("scales with pixel width at 1 bucket/px", () => {
    expect(bucketsForWidth(800)).toBe(800);
  });
});

describe("decimationEligible", () => {
  const base = {
    seriesColumnCount: 3,
    plottedCount: 3,
    xAscending: true,
    hasErrorBars: false,
    hasErrorSpans: false,
    defaultTrace: "Line",
    hasColorByColumns: false,
  };

  it("is eligible for the plain dense-line case", () => {
    expect(decimationEligible(base)).toBe(true);
  });

  it("disengages when extra columns are appended (overlay / ghost / selected companion)", () => {
    expect(decimationEligible({ ...base, seriesColumnCount: 5 })).toBe(false);
  });

  it("disengages when plotted is unknown or empty", () => {
    expect(decimationEligible({ ...base, plottedCount: undefined })).toBe(false);
    expect(decimationEligible({ ...base, plottedCount: 0, seriesColumnCount: 0 })).toBe(false);
  });

  it("disengages for non-ascending (loop) x", () => {
    expect(decimationEligible({ ...base, xAscending: false })).toBe(false);
  });

  it("disengages when any plotted column carries error bars or spans", () => {
    expect(decimationEligible({ ...base, hasErrorBars: true })).toBe(false);
    expect(decimationEligible({ ...base, hasErrorSpans: true })).toBe(false);
  });

  it("disengages in Scatter trace mode, but not Line + markers or Step", () => {
    expect(decimationEligible({ ...base, defaultTrace: "Scatter" })).toBe(false);
    expect(decimationEligible({ ...base, defaultTrace: "Line + markers" })).toBe(true);
    expect(decimationEligible({ ...base, defaultTrace: "Step" })).toBe(true);
  });

  it("disengages when any series uses colour-mapped scatter", () => {
    expect(decimationEligible({ ...base, hasColorByColumns: true })).toBe(false);
  });
});

describe("defaultDecimateWidthHint", () => {
  it("reads window.innerWidth in a DOM environment", () => {
    expect(defaultDecimateWidthHint()).toBe(window.innerWidth);
  });
});

// M1 (provenance-disclosure round 4, L2 regression): the shared predicate
// EVERY hasErrorSpans/hasErrorBars call site now routes through. FU-1 (this
// same lane) started stamping `Dataset.errorRoles` from real Origin
// designations; before this fix, `decimationRequestEligible`'s callers keyed
// `hasErrorSpans` off mere role PRESENCE, so any Origin book with an error
// designation ANYWHERE lost server-side decimation entirely -- even when the
// plotted channels never touch it. This is the test that would have caught
// that: `errorBindingsApplyToPlotted` must answer "does this apply to what's
// actually plotted", not "are there any roles at all".
describe("errorBindingsApplyToPlotted (M1)", () => {
  const yErr = (channel: number, target: number): ErrorBinding => ({
    channel,
    target,
    axis: "y",
    side: "both",
  });
  const xErr = (channel: number): ErrorBinding => ({ channel, target: -1, axis: "x", side: "both" });

  it("no bindings, or nothing plotted: never applies", () => {
    expect(errorBindingsApplyToPlotted(undefined, [0, 1], { xErrorRenders: true })).toBe(false);
    expect(errorBindingsApplyToPlotted([], [0, 1], { xErrorRenders: true })).toBe(false);
    expect(errorBindingsApplyToPlotted([yErr(1, 0)], [], { xErrorRenders: true })).toBe(false);
  });

  // The regression's OWN reproduction: the old code did `!!ds.errorRoles?.length`
  // -- true here (there IS a binding) -- so a genuinely unrelated Y-error cost
  // this dataset its decimation for every OTHER, unrelated plot of it.
  it("a Y-error binding on a channel that is NOT plotted (hidden/unplotted): does not apply -- stays eligible", () => {
    // Channel 0 is plotted; the Y-error targets channel 5, which is not.
    const roles: ErrorBinding[] = [yErr(6, 5)];
    const plotted = [0];
    // What every call site computed BEFORE this fix (useMultiPanelStage.ts's
    // two sites, usePlotPayload.ts's one): mere presence.
    const oldHasErrorSpans = !!roles?.length;
    expect(oldHasErrorSpans).toBe(true); // this is exactly the bug -- disables decimation for an unrelated dataset
    expect(errorBindingsApplyToPlotted(roles, plotted, { xErrorRenders: true })).toBe(false);
    // decimationRequestEligible itself flips as a direct result.
    const base = { hasErrorBars: false, hasColorByColumns: false } as const;
    expect(decimationRequestEligible({ ...base, hasErrorSpans: oldHasErrorSpans })).toBe(false); // old: wrongly ineligible
    expect(
      decimationRequestEligible({
        ...base,
        hasErrorSpans: errorBindingsApplyToPlotted(roles, plotted, { xErrorRenders: true }),
      }),
    ).toBe(true); // new: correctly eligible
  });

  it("a Y-error binding whose target IS plotted: applies -- not eligible", () => {
    expect(errorBindingsApplyToPlotted([yErr(1, 0)], [0, 2], { xErrorRenders: true })).toBe(true);
    // Order/position in `plotted` doesn't matter, only membership.
    expect(errorBindingsApplyToPlotted([yErr(1, 0)], [2, 0], { xErrorRenders: false })).toBe(true);
  });

  // The X-error nuance: `useMultiPanelStage.ts`'s panel render path draws
  // ONLY the legacy Y-only errorBars (lib/errorbars.originErrKeys explicitly
  // excludes X-error, "the plugin draws vertical whiskers only") -- no
  // errorSpansPlugin wired there at all, so an X-error-only book draws
  // NOTHING and must stay eligible for that path (xErrorRenders: false) --
  // restoring the pre-lane behavior for it.
  it("an X-error-only book stays eligible on a render path that never draws X-error (xErrorRenders: false)", () => {
    expect(errorBindingsApplyToPlotted([xErr(0)], [1, 2], { xErrorRenders: false })).toBe(false);
  });

  // The main single-plot Stage (usePlotPayload.ts) DOES draw X-error via
  // errorSpansPlugin (buildErrorSpans emits it against every plotted
  // column) -- decimating there would misalign that row-keyed magnitude
  // array exactly as plotDecimate.ts's own doc warns, so it correctly stays
  // INELIGIBLE (xErrorRenders: true) even though nothing is Y-bound.
  it("an X-error-only book is NOT eligible on a render path that draws X-error (xErrorRenders: true)", () => {
    expect(errorBindingsApplyToPlotted([xErr(0)], [1, 2], { xErrorRenders: true })).toBe(true);
  });

  it("an unrelated Y column plus an X-error: xErrorRenders alone decides, regardless of the Y side", () => {
    const bindings = [xErr(0), yErr(4, 9)]; // Y-error targets an unplotted channel
    expect(errorBindingsApplyToPlotted(bindings, [1], { xErrorRenders: false })).toBe(false);
    expect(errorBindingsApplyToPlotted(bindings, [1], { xErrorRenders: true })).toBe(true);
  });
});

describe("hasErrorMapEntries", () => {
  it("false for undefined or an empty map; true once something is keyed", () => {
    expect(hasErrorMapEntries(undefined)).toBe(false);
    expect(hasErrorMapEntries(new Map())).toBe(false);
    expect(hasErrorMapEntries(new Map([[1, "x"]]))).toBe(true);
  });
});

describe("decimationRequestEligible", () => {
  const base = {
    defaultTrace: "Line",
    hasErrorBars: false,
    hasErrorSpans: false,
    hasColorByColumns: false,
  };

  it("is eligible for the plain dense-line case", () => {
    expect(decimationRequestEligible(base)).toBe(true);
  });

  it("is eligible with no defaultTrace given (defaults to Line)", () => {
    expect(decimationRequestEligible({ ...base, defaultTrace: undefined })).toBe(true);
  });

  it("disengages when error bars or spans are bound", () => {
    expect(decimationRequestEligible({ ...base, hasErrorBars: true })).toBe(false);
    expect(decimationRequestEligible({ ...base, hasErrorSpans: true })).toBe(false);
  });

  it("disengages in Scatter trace mode only", () => {
    expect(decimationRequestEligible({ ...base, defaultTrace: "Scatter" })).toBe(false);
    expect(decimationRequestEligible({ ...base, defaultTrace: "Step" })).toBe(true);
  });

  it("disengages when any series uses colour-mapped scatter", () => {
    expect(decimationRequestEligible({ ...base, hasColorByColumns: true })).toBe(false);
  });
});

describe("shouldRefetchWindow (P3.4 zoom-refetch residual)", () => {
  it("fires only when a window is committed AND the base was server-decimated", () => {
    expect(shouldRefetchWindow([1, 2], true)).toBe(true);
  });

  it("never fires on autoscale/reset (xLim null), regardless of base state", () => {
    expect(shouldRefetchWindow(null, true)).toBe(false);
    expect(shouldRefetchWindow(null, false)).toBe(false);
  });

  it("never fires when the base payload was not server-decimated (nothing to recover)", () => {
    expect(shouldRefetchWindow([1, 2], false)).toBe(false);
  });
});

describe("visibleRowRange", () => {
  it("finds the first/last row index whose x falls in range", () => {
    const xs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(visibleRowRange(xs, 3, 6)).toEqual([3, 7]); // half-open, rows 3..6 inclusive
  });

  it("skips interior nulls without breaking the range", () => {
    const xs = [0, 1, null, 3, 4];
    expect(visibleRowRange(xs, 0, 4)).toEqual([0, 5]);
  });

  it("returns [0, 0] when nothing is in range", () => {
    expect(visibleRowRange([0, 1, 2], 10, 20)).toEqual([0, 0]);
  });
});

describe("xExtent", () => {
  it("returns the finite min/max, ignoring nulls/NaN", () => {
    expect(xExtent([5, null, 1, NaN, 9])).toEqual([1, 9]);
  });

  it("returns null when nothing is finite", () => {
    expect(xExtent([null, NaN])).toBeNull();
  });
});

describe("decimateRowIndices / buildDecimatedData", () => {
  it("passes a window with fewer rows than buckets through untouched (full detail on deep zoom)", () => {
    const xs = [0, 1, 2, 3, 4];
    const ys = [10, 20, 5, 30, 15];
    const data = buildDecimatedData([xs, ys], 0, 4, /* widthPx */ 400);
    expect(data[0]).toEqual(xs);
    expect(data[1]).toEqual(ys);
  });

  it("preserves the envelope: a single-sample spike buried in a wide window survives", () => {
    const n = 10_000;
    const xs = Array.from({ length: n }, (_, i) => i);
    const ys = new Array(n).fill(0);
    ys[5000] = 1_000_000;
    const data = buildDecimatedData([xs, ys], 0, n - 1, /* widthPx */ 100);
    expect(data[1]).toContain(1_000_000);
  });

  it("keeps output x monotonically non-decreasing (ascending source stays ascending)", () => {
    const n = 5000;
    const xs = Array.from({ length: n }, (_, i) => i);
    const ys = Array.from({ length: n }, (_, i) => Math.sin(i * 0.01));
    const data = buildDecimatedData([xs, ys], 0, n - 1, 300);
    const outX = data[0] as number[];
    for (let i = 1; i < outX.length; i++) {
      expect(outX[i]).toBeGreaterThanOrEqual(outX[i - 1]);
    }
  });

  it("keeps every column index-aligned to the SAME gathered rows (no cross-column mispairing)", () => {
    // Two series with DIFFERENT extrema locations — verifies the union-of-rows
    // gather keeps col[i] and companionCol[i] pointing at the same source row
    // (companionCol here stands in for what an error-bar column would need).
    const n = 2000;
    const xs = Array.from({ length: n }, (_, i) => i);
    const ys = Array.from({ length: n }, (_, i) => (i === 500 ? 999 : Math.sin(i * 0.02)));
    const companion = xs.map((x) => x * 10); // companion[i] === xs[i] * 10, always
    const data = buildDecimatedData([xs, ys, companion], 0, n - 1, 150);
    const outX = data[0] as number[];
    const outCompanion = data[2] as number[];
    for (let i = 0; i < outX.length; i++) {
      expect(outCompanion[i]).toBe(outX[i] * 10);
    }
  });

  it("pads the visible window by roughly one bucket-width of rows on each side", () => {
    const n = 1000;
    const xs = Array.from({ length: n }, (_, i) => i);
    const ys = Array.from({ length: n }, (_, i) => i % 7);
    // A narrow visible window in the middle of the series, at a low bucket
    // count — the padded lo/hi should reach outside [400, 420) on both sides.
    const data = buildDecimatedData([xs, ys], 400, 420, /* widthPx */ 10);
    const outX = data[0] as number[];
    expect(Math.min(...outX)).toBeLessThan(400);
    expect(Math.max(...outX)).toBeGreaterThan(420);
  });

  it("degrades to a small, harmless result when the window matches no data (panned off)", () => {
    const xs = [0, 1, 2, 3, 4];
    const ys = [1, 2, 3, 4, 5];
    expect(() => buildDecimatedData([xs, ys], 1000, 2000, 400)).not.toThrow();
  });

  it("decimateRowIndices unions independent per-series extrema (not just one series' picks)", () => {
    const n = 300;
    const a = new Array(n).fill(0);
    a[50] = 100; // series A's spike
    const b = new Array(n).fill(0);
    b[200] = -100; // series B's spike, a different row
    const rows = decimateRowIndices([a, b], 0, n, 10);
    expect(rows).toContain(50);
    expect(rows).toContain(200);
  });
});

describe("decimatePlugin", () => {
  // A minimal fake matching the uPlot surface the plugin touches: bbox.width,
  // width, scales.x.{min,max}, and setData(data, resetScales). Cast through
  // `unknown` (not `@ts-expect-error`) since a fake this much narrower than
  // uPlot's real instance type is an intentional, permanent mismatch, not a
  // one-off suppressed error.
  function fakePlot(scaleX: { min: number | null; max: number | null }) {
    const plot = {
      scales: { x: { ...scaleX } },
      bbox: { width: 200 },
      width: 200,
      setData: vi.fn(),
    };
    return { plot, asPlot: plot as unknown as uPlot };
  }

  // uPlot.Plugin's hook slots are typed as `Hook | Hook[] | undefined` (uPlot
  // itself normalizes to an array internally, and array elements are typed
  // possibly-undefined too); this module's plugin only ever returns a single
  // function, but calling through the full union needs runtime narrowing
  // (`unknown` + `typeof`) rather than a bare optional-call to satisfy tsc.
  function callHook(hook: unknown, ...args: unknown[]): void {
    const fns = Array.isArray(hook) ? hook : [hook];
    for (const fn of fns) if (typeof fn === "function") (fn as (...a: unknown[]) => void)(...args);
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ignores setScale calls before the ready hook fires (construction-time noise)", () => {
    const getFull = vi.fn(() => [
      [0, 1, 2, 3, 4],
      [1, 2, 3, 4, 5],
    ]);
    const plugin = decimatePlugin(getFull, 100);
    const { plot, asPlot } = fakePlot({ min: 0, max: 4 });
    callHook(plugin.hooks.setScale, asPlot, "x");
    vi.advanceTimersByTime(200);
    expect(plot.setData).not.toHaveBeenCalled();
  });

  it("debounces: only re-buckets once after the settle window, using the LATEST scale", () => {
    const getFull = vi.fn(() => [
      Array.from({ length: 100 }, (_, i) => i),
      Array.from({ length: 100 }, (_, i) => i % 5),
    ]);
    const plugin = decimatePlugin(getFull, 100);
    const { plot, asPlot } = fakePlot({ min: 0, max: 99 });
    callHook(plugin.hooks.ready, asPlot);
    callHook(plugin.hooks.setScale, asPlot, "x");
    vi.advanceTimersByTime(50);
    plot.scales.x = { min: 10, max: 20 }; // a second scale change before settle
    callHook(plugin.hooks.setScale, asPlot, "x");
    vi.advanceTimersByTime(50);
    expect(plot.setData).not.toHaveBeenCalled(); // still within the (restarted) debounce
    vi.advanceTimersByTime(100);
    expect(plot.setData).toHaveBeenCalledTimes(1);
    expect(plot.setData).toHaveBeenCalledWith(expect.anything(), false); // resetScales: false
  });

  it("ignores y-scale changes (only the x window drives re-bucketing)", () => {
    const getFull = vi.fn(() => [
      [0, 1, 2],
      [1, 2, 3],
    ]);
    const plugin = decimatePlugin(getFull, 100);
    const { plot, asPlot } = fakePlot({ min: 0, max: 2 });
    callHook(plugin.hooks.ready, asPlot);
    callHook(plugin.hooks.setScale, asPlot, "y");
    vi.advanceTimersByTime(200);
    expect(plot.setData).not.toHaveBeenCalled();
  });

  it("destroy cancels a pending debounce timer", () => {
    const getFull = vi.fn(() => [
      [0, 1, 2],
      [1, 2, 3],
    ]);
    const plugin = decimatePlugin(getFull, 100);
    const { plot, asPlot } = fakePlot({ min: 0, max: 2 });
    callHook(plugin.hooks.ready, asPlot);
    callHook(plugin.hooks.setScale, asPlot, "x");
    callHook(plugin.hooks.destroy, asPlot);
    vi.advanceTimersByTime(200);
    expect(plot.setData).not.toHaveBeenCalled();
  });
});
