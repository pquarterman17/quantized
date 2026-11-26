// Plan item 20: half / split violin, paired before-after, lollipop and stacked
// histogram, screen <-> export parity, pinned to the shared wire fixtures
// `tests/fixtures/wire/stat_{sideviolin,paired,lollipop,stackhist}.json` (their
// Python half, `tests/test_stat_dist3.py`, draws the same requests with matplotlib).
//
// The real hook is driven on the fixture columns (a NaN row and an excluded row
// must drop out), the export request it posts must be the fixture request, the
// TS builders must equal the Python geometry, the canvas painters must draw the
// fixture vertices, and the new picks must survive a real save and reopen.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsHistogramMulti } from "../../lib/api";
import { exportStatplotFigure } from "../../lib/api/figures";
import { statsRidgeline } from "../../lib/api/statsDist2";
import {
  lollipopGeometry,
  lollipopSeries,
  pairedGeometry,
  pairedSeries,
  sideViolinGeometry,
  stackGeometry,
  type LollipopGeometry,
  type LollipopSeries,
  type PairedGeometry,
  type PairedSeries,
  type Side,
  type SideViolinGeometry,
  type StackGeometry,
} from "../../lib/statDist3";
import type { RidgelineWire } from "../../lib/statRidgeline";
import { finiteDomain, zeroBasedDomain } from "../../lib/statstage";
import type { DataStruct, Dataset } from "../../lib/types";
import { parseWorkspace } from "../../lib/workspace";
import { serializeWorkspace } from "../../lib/workspaceSerialize";
import { setStatPicks } from "../../store/statLevelOptions";
import { useActiveDataset, useApp } from "../../store/useApp";
import { computeGroupedDraw, dist3ExportSpec, splitLayout } from "./statDist3Draw";
import { draw } from "./statRender";
import { useStatStage } from "./useStatStage";

vi.mock("../../lib/api/statsDist2", () => ({ statsMarginal: vi.fn(), statsRidgeline: vi.fn() }));
vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  statsHistogramMulti: vi.fn(),
}));
vi.mock("../../lib/api/figures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/figures")>()),
  exportStatplotFigure: vi.fn(),
}));

const here = dirname(fileURLToPath(import.meta.url));
const wire = (name: string) => JSON.parse(readFileSync(join(here, "../../../../tests/fixtures/wire", name), "utf-8"));
type Req = Record<string, unknown> & { data: number[][]; labels: string[]; dist3: Record<string, unknown> };
const SIDE = wire("stat_sideviolin.json").cases as Record<
  "split" | "half",
  { request: Req; response: RidgelineWire; geometry: SideViolinGeometry }
>;
const PAIRED = wire("stat_paired.json") as { request: Req; response: PairedSeries; geometry: PairedGeometry };
const LOLLI = wire("stat_lollipop.json") as { request: Req; response: LollipopSeries; geometry: LollipopGeometry };
const STACK = wire("stat_stackhist.json") as {
  request: Req;
  response: { edges: number[]; series: { counts: number[] }[] };
  geometry: StackGeometry;
};

const nan = Number.NaN;
const stripPalette = (r: unknown) => {
  const { palette: _p, ...rest } = r as Record<string, unknown>;
  return rest;
};

/** Channels of different lengths, NaN padded, plus a last row that is EXCLUDED. */
function channels(labels: string[], cols: number[][]): DataStruct {
  const rows = Math.max(...cols.map((c) => c.length));
  return {
    time: [...Array.from({ length: rows }, (_, i) => i), rows],
    values: [...Array.from({ length: rows }, (_, i) => cols.map((c) => c[i] ?? nan)), cols.map(() => 500)],
    labels,
    units: labels.map(() => ""),
    metadata: {},
  };
}
const dataset = (id: string, data: DataStruct): Dataset => ({ id, name: `${id}.csv`, data, excludedRows: [data.time.length - 1] });

function useWiredStage() {
  return useStatStage({
    active: useActiveDataset(), yKeys: null, xKey: null, seriesOrder: null, seed: null,
    onSeedConsumed: () => {}, picks: useApp((s) => s.statPicks), onPicksChange: setStatPicks,
  });
}

function load(id: string, data: DataStruct) {
  const init = useApp.getInitialState();
  useApp.setState({
    datasets: [dataset(id, data)], activeId: id, statMode: true, statPicks: {},
    plotWindows: init.plotWindows, focusedWindowId: init.focusedWindowId, history: [], future: [],
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(exportStatplotFigure).mockResolvedValue(undefined);
});

const exported = async (hook: { result: { current: { exportFigure: (f: string) => Promise<unknown> } } }) => {
  await act(async () => {
    await hook.result.current.exportFigure("svg");
  });
  return vi.mocked(exportStatplotFigure).mock.calls.at(-1)![0];
};

// ── the canvas painter, recorded ───────────────────────────────────────────

type Path = [number, number][];
function recorder() {
  const paths: Path[] = [];
  const arcs: [number, number][] = [];
  const rects: [number, number, number, number][] = [];
  let cur: Path = [];
  const noop = () => {};
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(_t, k: string) {
      if (k === "beginPath") return () => { cur = []; };
      if (k === "moveTo" || k === "lineTo") return (x: number, y: number) => cur.push([x, y]);
      if (k === "stroke" || k === "fill") return () => paths.push(cur);
      if (k === "arc") return (x: number, y: number) => arcs.push([x, y]);
      if (k === "rect" || k === "fillRect" || k === "strokeRect") return (x: number, y: number, w: number, h: number) => rects.push([x, y, w, h]);
      return noop;
    },
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, paths, arcs, rects };
}
const canvas = (ctx: CanvasRenderingContext2D) => ({ getContext: () => ctx, width: 0, height: 0 }) as unknown as HTMLCanvasElement;
const host = { clientWidth: 600, clientHeight: 400 } as HTMLElement;
const RECT = { x: 60, y: 20, w: 520, h: 332 }; // the plot rect of a 600 x 400 canvas
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const mapper = (xd: [number, number], yd: [number, number]) => ({
  sx: (v: number) => RECT.x + ((v - xd[0]) / (xd[1] - xd[0])) * RECT.w,
  sy: (v: number) => RECT.y + RECT.h - ((v - yd[0]) / (yd[1] - yd[0])) * RECT.h,
});
const hasPath = (paths: Path[], poly: [number, number][]) =>
  paths.some((p) => p.length === poly.length && p.every((v, i) => near(v[0], poly[i][0]) && near(v[1], poly[i][1])));
const hasPoint = (pts: [number, number][], p: [number, number]) => pts.some((q) => near(q[0], p[0]) && near(q[1], p[1]));

// ── half / split violin ────────────────────────────────────────────────────

async function halfViolin() {
  load("h", channels(["A", "B", "C", "D"], SIDE.half.request.data));
  vi.mocked(statsRidgeline).mockResolvedValue(SIDE.half.response);
  const hook = renderHook(() => useWiredStage());
  act(() => hook.result.current.setMode("sideviolin"));
  act(() => hook.result.current.setGroupCol(null));
  await waitFor(() => expect(hook.result.current.draw?.mode).toBe("sideviolin"));
  return hook;
}

describe("half violin: the stage and the fixture agree", () => {
  it("asks for each channel's finite, non-excluded values and exports the fixture request", async () => {
    const hook = await halfViolin();
    expect(vi.mocked(statsRidgeline).mock.calls.at(-1)![0]).toEqual(SIDE.half.request.data);
    const spec = await exported(hook);
    expect(stripPalette(spec)).toEqual(stripPalette({ ...SIDE.half.request, y_label: "value" }));
  });

  it("the TS builder equals the Python geometry, and the canvas draws it", async () => {
    for (const style of ["half", "split"] as const) {
      const c = SIDE[style];
      const d = c.request.dist3 as { slots: number[]; sides: Side[] };
      expect(sideViolinGeometry(c.response, d.slots, d.sides, style)).toEqual(c.geometry);
    }
    const hook = await halfViolin();
    const { ctx, paths } = recorder();
    draw(canvas(ctx), host, hook.result.current.draw);
    const geo = SIDE.half.geometry;
    const { sx, sy } = mapper(geo.x_domain, geo.y_domain);
    const px = (poly: [number, number][]): [number, number][] => poly.map(([x, y]) => [sx(x), sy(y)]);
    for (const v of geo.violins) {
      expect(hasPath(paths, px(v.fill)), "fill").toBe(true);
      expect(hasPath(paths, px(v.line)), "line").toBe(true);
      expect(v.line.every(([x]) => x >= v.slot)).toBe(true); // the right side only
    }
  });

  it("the half / split pick and bandwidth reach the draw and the request", async () => {
    const hook = await halfViolin();
    act(() => hook.result.current.setDist2({ ridgeBw: "0.3" }));
    await waitFor(() => expect(vi.mocked(statsRidgeline).mock.calls.at(-1)![1]).toBe(0.3));
    act(() => hook.result.current.setDist2({ violinSide: "split" }));
    await waitFor(() => expect(hook.result.current.error).toMatch(/"then by"/)); // channels have no second factor
  });
});

describe("split violin: positions, sides and the request", () => {
  const labels = SIDE.split.request.labels;
  it("pairs the two levels back to back at each position", () => {
    expect(splitLayout(labels, "h")).toEqual({
      positions: [0, 0, 1, 1], sides: ["left", "right", "left", "right"],
      slotLabels: ["g = A", "g = B"], levels: ["h = x", "h = y"],
    });
  });

  it("refuses a missing or three-level second factor by name", () => {
    expect(() => splitLayout(labels, null)).toThrow(/"then by"/);
    expect(() => splitLayout([...labels, "g = B / h = z"], "h")).toThrow(/exactly 2.*found 3/);
  });

  it("a level absent at one position keeps its side empty", () => {
    const l = splitLayout(["g = A / h = x", "g = A / h = y", "g = B / h = y"], "h");
    expect(l.positions).toEqual([0, 0, 1]);
    expect(l.sides).toEqual(["left", "right", "right"]);
  });

  it("the draw's export request is the fixture request", async () => {
    vi.mocked(statsRidgeline).mockResolvedValue(SIDE.split.response);
    const groups = SIDE.split.request.data.map((values, i) => ({ label: labels[i], values }));
    const d = await computeGroupedDraw("sideviolin", groups, {
      side: "split", bw: "scott", stat: "mean", sort: "none",
      valueLabel: "value", nestLabel: "h",
    });
    expect(stripPalette(dist3ExportSpec(d, "svg"))).toEqual(stripPalette(SIDE.split.request));
    const { ctx, paths } = recorder();
    draw(canvas(ctx), host, d);
    const geo = SIDE.split.geometry;
    const { sx, sy } = mapper(geo.x_domain, geo.y_domain);
    for (const v of geo.violins) expect(hasPath(paths, v.line.map(([x, y]) => [sx(x), sy(y)])), "split outline").toBe(true);
    expect(geo.violins.map((v) => v.color)).toEqual([0, 1, 0, 1]); // colour = side
  });
});

// ── paired ─────────────────────────────────────────────────────────────────

async function paired() {
  const [b, a] = PAIRED.request.data;
  // row 3 is incomplete (NaN before): it must leave the lines, points and means together
  load("p", channels(["before", "after"], [[...b, nan], [...a, 7]]));
  const hook = renderHook(() => useWiredStage());
  act(() => hook.result.current.setMode("paired"));
  act(() => hook.result.current.setValueCol(0));
  act(() => hook.result.current.setHistCols([1]));
  act(() => hook.result.current.setDist2({ pairedCi: true }));
  await waitFor(() => expect(hook.result.current.draw?.mode).toBe("paired"));
  return hook;
}

describe("paired before-after: the stage and the fixture agree", () => {
  it("drops incomplete rows and exports the fixture request", async () => {
    const hook = await paired();
    const spec = await exported(hook);
    expect(stripPalette(spec)).toEqual(stripPalette(PAIRED.request));
  });

  it("the TS series and geometry equal the Python ones", () => {
    const s = pairedSeries(PAIRED.request.data[0], PAIRED.request.data[1]);
    expect(s.before).toEqual(PAIRED.response.before);
    s.sides.forEach((side, i) => {
      for (const k of ["mean", "lo", "hi"] as const) expect(side[k]).toBeCloseTo(PAIRED.response.sides[i][k], 9);
    });
    const g = pairedGeometry(PAIRED.response, true);
    expect(g.lines).toEqual(PAIRED.geometry.lines);
    expect(g.y_domain[0]).toBeCloseTo(PAIRED.geometry.y_domain[0], 9);
    expect(g.y_domain[1]).toBeCloseTo(PAIRED.geometry.y_domain[1], 9);
  });

  it("the canvas draws a line per subject, the points and the CI marker", async () => {
    const hook = await paired();
    const { ctx, paths, arcs, rects } = recorder();
    draw(canvas(ctx), host, hook.result.current.draw);
    const geo = PAIRED.geometry;
    const { sx, sy } = mapper(geo.x_domain, geo.y_domain);
    for (const [a, b] of geo.lines) expect(hasPath(paths, [[sx(a[0]), sy(a[1])], [sx(b[0]), sy(b[1])]]), "subject line").toBe(true);
    for (const p of [...geo.before, ...geo.after]) expect(hasPoint(arcs, [sx(p[0]), sy(p[1])]), "point").toBe(true);
    for (const m of geo.means) {
      expect(hasPath(paths, [[sx(m.x), sy(m.lo)], [sx(m.x), sy(m.hi)], [sx(m.x) - 4, sy(m.lo)], [sx(m.x) + 4, sy(m.lo)], [sx(m.x) - 4, sy(m.hi)], [sx(m.x) + 4, sy(m.hi)]]), "CI bar").toBe(true);
      expect(rects.some((r) => near(r[0] + r[2] / 2, sx(m.x)) && near(r[1] + r[3] / 2, sy(m.mean))), "mean marker").toBe(true);
    }
  });

  it("the CI toggle redraws without a backend call; one pair is refused with a message", async () => {
    const hook = await paired();
    act(() => hook.result.current.setDist2({ pairedCi: false }));
    await waitFor(() => expect(hook.result.current.draw?.mode === "paired" && hook.result.current.draw.ci).toBe(false));
    load("q", channels(["before", "after"], [[1, nan], [2, 3]]));
    const { result } = renderHook(() => useWiredStage());
    act(() => result.current.setMode("paired"));
    await waitFor(() => expect(result.current.error).toMatch(/at least 2/));
    expect(result.current.draw).toBeNull();
  });
});

// ── lollipop ───────────────────────────────────────────────────────────────

async function lollipop() {
  load("l", channels(["a", "b", "c", "d"], LOLLI.request.data));
  const hook = renderHook(() => useWiredStage());
  act(() => hook.result.current.setMode("lollipop"));
  act(() => hook.result.current.setGroupCol(null));
  act(() => hook.result.current.setDist2({ lollipopStat: "median", lollipopSort: "desc" }));
  await waitFor(() => expect(hook.result.current.draw?.mode).toBe("lollipop"));
  await waitFor(() => expect(hook.result.current.draw?.mode === "lollipop" && hook.result.current.draw.series.sort).toBe("desc"));
  return hook;
}

describe("lollipop: the stage and the fixture agree", () => {
  it("summarises each channel's finite values and exports the fixture request", async () => {
    const hook = await lollipop();
    const spec = await exported(hook);
    expect(stripPalette(spec)).toEqual(stripPalette(LOLLI.request));
  });

  it("the TS series and geometry equal the Python ones (ties keep their order)", () => {
    const s = lollipopSeries(LOLLI.request.data, "median", "desc");
    expect(s).toEqual(LOLLI.response);
    expect(lollipopGeometry(s)).toEqual(LOLLI.geometry);
    expect(lollipopSeries([[4], [4]], "mean", "asc").order).toEqual([0, 1]);
  });

  it("the canvas draws each stem and dot at the fixture vertices", async () => {
    const hook = await lollipop();
    const { ctx, paths, arcs } = recorder();
    draw(canvas(ctx), host, hook.result.current.draw);
    const geo = LOLLI.geometry;
    const { sx, sy } = mapper(geo.x_domain, geo.y_domain);
    for (const [a, b] of geo.stems) expect(hasPath(paths, [[sx(a[0]), sy(a[1])], [sx(b[0]), sy(b[1])]]), "stem").toBe(true);
    for (const p of geo.dots) expect(hasPoint(arcs, [sx(p[0]), sy(p[1])]), "dot").toBe(true);
  });

  it("the statistic and order change the draw", async () => {
    const hook = await lollipop();
    act(() => hook.result.current.setDist2({ lollipopStat: "mean", lollipopSort: "none" }));
    await waitFor(() => expect(hook.result.current.draw?.mode === "lollipop" && hook.result.current.draw.series.order).toEqual([0, 1, 2, 3]));
  });
});

// ── stacked histogram ──────────────────────────────────────────────────────

async function stacked(on: boolean) {
  load("s", channels(["a", "b", "c"], STACK.request.data));
  vi.mocked(statsHistogramMulti).mockResolvedValue({ ...STACK.response, n_bins: 0 } as never);
  const hook = renderHook(() => useWiredStage());
  act(() => hook.result.current.setMode("histogram"));
  act(() => hook.result.current.setValueCol(0));
  act(() => hook.result.current.setHistCols([1, 2]));
  act(() => hook.result.current.setBins("sturges"));
  act(() => hook.result.current.setDist2({ histStack: on }));
  await waitFor(() => expect(hook.result.current.draw?.mode).toBe("histogram"));
  await waitFor(() => expect(!!(hook.result.current.draw?.mode === "histogram" && hook.result.current.draw.series)).toBe(true));
  return hook;
}

describe("stacked histogram: the stage and the fixture agree", () => {
  it("bins the finite columns once and exports the fixture request", async () => {
    const hook = await stacked(true);
    expect(vi.mocked(statsHistogramMulti).mock.calls.at(-1)).toEqual([STACK.request.data, "sturges"]);
    const spec = await exported(hook);
    expect(stripPalette(spec)).toEqual(stripPalette(STACK.request));
  });

  it("the TS builder equals the Python bars", () => {
    expect(stackGeometry(STACK.response.edges, STACK.response.series.map((s) => s.counts))).toEqual(STACK.geometry);
  });

  it("the canvas stacks each series on the running total", async () => {
    const hook = await stacked(true);
    const { ctx, rects } = recorder();
    draw(canvas(ctx), host, hook.result.current.draw);
    const g = STACK.geometry;
    const [y0, y1] = zeroBasedDomain([[g.y_max]]); // the Y domain reaches the tallest STACK, not the tallest bar
    const [x0, x1] = finiteDomain([g.edges]); // the canvas pads the bin range
    const sx = (v: number) => RECT.x + ((v - x0) / (x1 - x0)) * RECT.w;
    const sy = (v: number) => RECT.y + RECT.h - ((v - y0) / (y1 - y0)) * RECT.h;
    let drawn = 0;
    for (const row of g.bars) {
      for (const [b0, b1, base, top] of row) {
        if (top === base) continue;
        const want = [sx(b0), sy(top), sx(b1) - sx(b0), sy(base) - sy(top)];
        expect(rects.some((r) => r.every((v, i) => near(v, want[i]))), `bar ${b0}..${b1} on ${base}`).toBe(true);
        drawn++;
      }
    }
    expect(drawn).toBeGreaterThan(g.edges.length - 1); // more than one series is drawn
    expect(g.bars[1].some(([, , base]) => base > 0)).toBe(true); // and a later series really sits above 0
  });

  it("stacking changes the draw, not the request; off by default", async () => {
    const hook = await stacked(false);
    expect(hook.result.current.draw?.mode === "histogram" && hook.result.current.draw.stack).toBeFalsy();
    const calls = vi.mocked(statsHistogramMulti).mock.calls.length;
    act(() => hook.result.current.setDist2({ histStack: true }));
    await waitFor(() => expect(hook.result.current.draw?.mode === "histogram" && hook.result.current.draw.stack).toBe(true));
    expect(vi.mocked(statsHistogramMulti).mock.calls.length).toBe(calls); // toggling never refetches
  });
});

// ── projects ───────────────────────────────────────────────────────────────

/** Save the workspace, drop it, reopen it and read the stage back. */
function reopen() {
  const s = useApp.getState();
  const text = serializeWorkspace({ ...s, plotWindows: s.windowsForSave() });
  useApp.setState({ statPicks: {}, datasets: [] });
  useApp.getState().loadWorkspace(parseWorkspace(text));
  return renderHook(() => useWiredStage()).result.current;
}

describe("the new picks survive a save and reopen", () => {
  it("half / split violin: the side and bandwidth", () => {
    load("d", channels(["a", "b"], [[1, 2], [3, 4]]));
    const { result } = renderHook(() => useWiredStage());
    act(() => result.current.setMode("sideviolin"));
    act(() => result.current.setDist2({ violinSide: "split", ridgeBw: "0.3" }));
    const r = reopen();
    expect([r.mode, r.dist2.violinSide, r.dist2.ridgeBw]).toEqual(["sideviolin", "split", "0.3"]);
  });

  it("paired: the CI toggle and the after column", () => {
    load("d", channels(["a", "b"], [[1, 2], [3, 4]]));
    const { result } = renderHook(() => useWiredStage());
    act(() => result.current.setMode("paired"));
    act(() => result.current.setHistCols([1]));
    act(() => result.current.setDist2({ pairedCi: true }));
    const r = reopen();
    expect([r.mode, r.dist2.pairedCi, r.histCols]).toEqual(["paired", true, [1]]);
  });

  it("lollipop: the statistic and the order", () => {
    load("d", channels(["a", "b"], [[1, 2], [3, 4]]));
    const { result } = renderHook(() => useWiredStage());
    act(() => result.current.setMode("lollipop"));
    act(() => result.current.setDist2({ lollipopStat: "median", lollipopSort: "desc" }));
    const r = reopen();
    expect([r.mode, r.dist2.lollipopStat, r.dist2.lollipopSort]).toEqual(["lollipop", "median", "desc"]);
  });

  it("stacked histogram: the toggle", () => {
    load("d", channels(["a", "b"], [[1, 2], [3, 4]]));
    const { result } = renderHook(() => useWiredStage());
    act(() => result.current.setHistCols([1]));
    act(() => result.current.setDist2({ histStack: true }));
    expect(reopen().dist2.histStack).toBe(true);
  });

  it("each mode's save always carries its own picks, so an older build refuses it", () => {
    load("d", channels(["a", "b"], [[1, 2], [3, 4]]));
    const { result } = renderHook(() => useWiredStage());
    act(() => result.current.setMode("sideviolin"));
    expect(useApp.getState().statPicks).toMatchObject({ mode: "sideviolin", violinSide: "half", ridgeBw: "scott" });
    act(() => result.current.setMode("paired"));
    expect(useApp.getState().statPicks).toMatchObject({ mode: "paired", pairedCi: false });
    act(() => result.current.setMode("lollipop"));
    expect(useApp.getState().statPicks).toMatchObject({ mode: "lollipop", lollipopStat: "mean", lollipopSort: "none" });
  });

  it("an out-of-list pick is dropped on load (fail closed)", () => {
    load("d", channels(["a", "b"], [[1, 2], [3, 4]]));
    useApp.setState({ statPicks: { mode: "lollipop", lollipopStat: "mode" as "mean", lollipopSort: "up" as "asc", violinSide: "full" as "half", histStack: "yes" as unknown as boolean } });
    const s = useApp.getState();
    const text = serializeWorkspace({ ...s, plotWindows: s.windowsForSave() });
    useApp.getState().loadWorkspace(parseWorkspace(text));
    expect(useApp.getState().statPicks).toEqual({ mode: "lollipop" });
  });
});
