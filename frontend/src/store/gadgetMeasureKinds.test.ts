// The curve-measurement gadget's level-crossing kind and settings, driven through
// the real store (the calc is the route's, mocked at its wrapper): the request it
// sends, the units and source rows it stamps, the second curve from another
// worksheet, and Commit writing the panel's worksheet with the region recorded.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { reportTable } from "../components/Stage/gadgetMeasureReport";
import { commitGadgetMeasure } from "../components/Stage/gadgetMeasureCommit";
import type { IntersectResult, LevelCrossingResult, StepTimeResult } from "../lib/api/curveMeasure";
import { DEFAULT_GADGET_MEASURE_OPTIONS } from "../lib/gadgetMeasureOptions";
import type { DataStruct } from "../lib/types";
import { useGadgetMeasureOptions } from "./gadgetMeasureOptions";
import { useApp } from "./useApp";

const { inter, level, step } = vi.hoisted(() => ({ inter: vi.fn(), level: vi.fn(), step: vi.fn() }));
vi.mock("../lib/api/curveMeasure", () => ({ measureIntersect: inter, measureLevelCrossings: level, measureStepTime: step }));

const T = [0, 1, 2, 3, 4, 5, 6, 7];
const Y = [-2, 0, 3, 5, 1, -1, 4, 6]; // min -2, max 6 over the whole sheet
const sheet = (cols: number[][], units: string[], time = T, meta: Record<string, unknown> = {}): DataStruct => ({
  time, values: time.map((_, i) => cols.map((c) => c[i]!)), labels: cols.map((_, i) => ["A", "B", "C"][i]!), units, metadata: meta,
});
const LEVEL: LevelCrossingResult = {
  level: 2, hysteresis: 0, crossings: [{ x: 1.4, direction: "rising" }, { x: 3.5, direction: "falling" }],
  n_points: 6, dropped: 0, merged_duplicates: 0,
};
const INTER: IntersectResult = {
  intersections: [{ x: 2.5, y: 2.5, kind: "cross", direction: "falling", x_end: 2.5 }],
  x_min: 0, x_max: 7, n_grid: 8, dropped_a: 0, dropped_b: 0, merged_a: 0, merged_b: 0,
};
const STEP = {
  edge: "rise", time: 1.2, x_low: 2.4, x_high: 3.6, low_fraction: 0.2, high_fraction: 0.8, low_plateau: 0, high_plateau: 10,
  low_level: 2, high_level: 8, plateaus_estimated: [true, true], plateau_method: "histogram", n_points: 8, dropped: 0, merged_duplicates: 0,
} as StepTimeResult;

function load(over: Record<string, unknown> = {}, extra: Record<string, unknown>[] = []) {
  useApp.setState({
    datasets: [{ id: "a", name: "a", data: sheet([Y, T.map((v) => 5 - v)], ["V", "V"], T, { x_column_unit: "s" }) }, ...extra] as never,
    activeId: "a", yKeys: null, xKey: null, hiddenChannels: [], seriesOrder: null,
    qfitRoi: null, gadgetBusy: false, gadgetError: null, gadgetMeasure: null, gadgetCurveB: null, gadgetCursors: null,
    gadgetCursorResult: null, gadgetMode: "levelcrossing", ...over,
  });
}

beforeAll(async () => {
  await useApp.getState().runQuickFit(); // loads the lazy compute bodies once
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  level.mockResolvedValue(LEVEL);
  inter.mockResolvedValue(INTER);
  step.mockResolvedValue(STEP);
  useGadgetMeasureOptions.setState({ options: DEFAULT_GADGET_MEASURE_OPTIONS });
});

describe("level-crossings gadget", () => {
  it("sends the ROI rows with the middle of their Y range as the default level", async () => {
    load({ qfitRoi: [1, 5] });
    await useApp.getState().runGadget();
    // Rows x = 1..5 hold y = 0, 3, 5, 1, -1: (min + max) / 2 = (-1 + 5) / 2 = 2.
    expect(level.mock.calls[0]![0]).toEqual({ x: [1, 2, 3, 4, 5], y: [0, 3, 5, 1, -1], level: 2, hysteresis: 0, direction: "both" });
    expect(useApp.getState().gadgetMeasure).toMatchObject({ mode: "levelcrossing", auto: true, r: LEVEL });
  });

  it("takes the typed level, dead band and direction, and a change measures again", async () => {
    vi.useFakeTimers();
    load({ qfitRoi: [0, 7] });
    useGadgetMeasureOptions.getState().set({ level: "2.5", hysteresis: "0.25", direction: "rising" });
    useApp.getState().setQfitRoi([0, 7]); // what the chip does after a change
    await vi.advanceTimersByTimeAsync(500);
    expect(level.mock.calls[0]![0]).toMatchObject({ level: 2.5, hysteresis: 0.25, direction: "rising" });
    expect(useApp.getState().gadgetMeasure).toMatchObject({ mode: "levelcrossing", auto: false });
  });

  it("stamps the units of the columns and the SOURCE rows of the region", async () => {
    // Row 2 (0-based) is excluded: the region 1..5 then holds source rows 1, 3, 4, 5 -> shown 2..6.
    load({ qfitRoi: [1, 5] });
    useApp.setState({ datasets: useApp.getState().datasets.map((d) => ({ ...d, excludedRows: [2] })) });
    await useApp.getState().runGadget();
    const m = useApp.getState().gadgetMeasure as { units: unknown; source: { rows: unknown; roi: unknown } };
    expect(m.units).toEqual({ x: "s", y: "V", yB: "" });
    expect(m.source.rows).toEqual({ first: 2, last: 6, n: 4 });
    expect(m.source.roi).toEqual([1, 5]);
  });

  it("names a bad entry instead of sending a request", async () => {
    load({ qfitRoi: [0, 7] });
    useGadgetMeasureOptions.getState().set({ level: "abc" });
    await useApp.getState().runGadget();
    expect(level).not.toHaveBeenCalled();
    expect(useApp.getState().gadgetError).toMatch(/level is not a number/);
    expect(useApp.getState().gadgetBusy).toBe(false);
  });
});

describe("rise-time settings", () => {
  it("20 / 80 and reference levels reach the request; the default does not add them", async () => {
    load({ gadgetMode: "risetime", qfitRoi: [0, 7] });
    useGadgetMeasureOptions.getState().set({ stepPreset: "20-80", lowLevel: "0", highLevel: "10", edge: "rise" });
    await useApp.getState().runGadget();
    expect(step.mock.calls[0]![0]).toMatchObject({ low_fraction: 0.2, high_fraction: 0.8, edge: "rise", low_level: 0, high_level: 10 });
    step.mockClear();
    useGadgetMeasureOptions.setState({ options: DEFAULT_GADGET_MEASURE_OPTIONS });
    await useApp.getState().runGadget();
    expect(step.mock.calls[0]![0]).toEqual({ x: T, y: Y, low_fraction: 0.1, high_fraction: 0.9, edge: "auto" });
  });
});

describe("intersect with a curve of another worksheet", () => {
  const OTHER = { id: "b", name: "other", data: sheet([[9, 8, 7, 6, 5, 4, 3, 2], [1, 2, 3, 4, 5, 6, 7, 8]], ["", "mA"], T) };

  it("reads the ROI rows of the picked channel of that worksheet, and says where it came from", async () => {
    load({ gadgetMode: "intersect", qfitRoi: [2, 4] }, [OTHER]);
    useGadgetMeasureOptions.getState().set({ curveBSheet: "b" });
    useApp.setState({ gadgetCurveB: 1 });
    await useApp.getState().runGadget();
    expect(inter.mock.calls[0]![0]).toEqual({ x1: [2, 3, 4], y1: [3, 5, 1], x2: [2, 3, 4], y2: [3, 4, 5] });
    const m = useApp.getState().gadgetMeasure as { bKey: number; source: { bSheet: string }; units: { yB: string } };
    expect(m.bKey).toBe(1);
    expect(m.source.bSheet).toBe("b");
    expect(m.units.yB).toBe("mA");
  });

  it("refuses when that worksheet is gone", async () => {
    load({ gadgetMode: "intersect", qfitRoi: [2, 4] });
    useGadgetMeasureOptions.getState().set({ curveBSheet: "gone" });
    await useApp.getState().runGadget();
    expect(inter).not.toHaveBeenCalled();
    expect(useApp.getState().gadgetError).toMatch(/second curve's worksheet/);
  });

  it("the default (this worksheet, next plotted curve) is unchanged", async () => {
    load({ gadgetMode: "intersect", qfitRoi: [0, 7] }, [OTHER]);
    await useApp.getState().runGadget();
    expect(inter.mock.calls[0]![0]).toEqual({ x1: T, y1: Y, x2: T, y2: T.map((v) => 5 - v) });
  });
});

function commitNow(): void {
  const s = useApp.getState();
  commitGadgetMeasure({ m: s.gadgetMeasure as never, activeId: s.activeId, datasets: s.datasets, setStatus: s.setStatus });
}

describe("Commit and Report", () => {
  it("Commit adds the panel's worksheet (crossing, level, direction) and records the region and its source rows", async () => {
    load({ qfitRoi: [1, 5] });
    await useApp.getState().runGadget();
    commitNow();
    await vi.waitFor(() => expect(useApp.getState().datasets).toHaveLength(2));
    const out = useApp.getState().datasets[1]!;
    expect(out.name).toBe("a (level crossings)");
    expect(out.data.time).toEqual([1.4, 3.5]);
    expect(out.data.values).toEqual([[2, 1], [2, -1]]);
    const result = useApp.getState().analysisResults.at(-1)!;
    expect(result.producer.id).toBe("curve-measure");
    const text = JSON.stringify(result.parameters);
    expect(text).toContain("\"roi\":[1,5]");
    expect(text).toContain("includedRows"); // the source rows the region held, recorded by the shared contract
  });

  it("a repeated Commit of the same measurement adds nothing more", async () => {
    load({ qfitRoi: [1, 5] });
    await useApp.getState().runGadget();
    const s = useApp.getState();
    const ctx = { m: s.gadgetMeasure as never, activeId: s.activeId, datasets: s.datasets, setStatus: s.setStatus };
    commitGadgetMeasure(ctx);
    await vi.waitFor(() => expect(useApp.getState().datasets).toHaveLength(2));
    commitGadgetMeasure(ctx);
    expect(useApp.getState().datasets).toHaveLength(2);
  });

  it("refuses with a reason when nothing was found", async () => {
    level.mockResolvedValue({ ...LEVEL, crossings: [] });
    load({ qfitRoi: [1, 5] });
    await useApp.getState().runGadget();
    commitNow();
    expect(useApp.getState().datasets).toHaveLength(1);
  });

  it("the report table carries units in its headings and one row per crossing", async () => {
    load({ qfitRoi: [1, 5] });
    await useApp.getState().runGadget();
    const m = useApp.getState().gadgetMeasure as Parameters<typeof reportTable>[0];
    expect(reportTable(m)).toEqual({
      columns: ["x (s)", "y (V)", "direction"],
      records: [
        { "x (s)": 1.4, "y (V)": 2, direction: "rising" },
        { "x (s)": 3.5, "y (V)": 2, direction: "falling" },
      ],
    });
  });
});
