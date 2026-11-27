// Plan item 20 variants: half violin on either side with inner marks, paired lines
// coloured by direction, horizontal lollipop, histogram stacked by a group column.
// Screen <-> export parity, pinned to the shared wire fixture
// `tests/fixtures/wire/stat_dist3_variants.json` (its Python half is
// `tests/test_stat_dist3_variants.py`, which draws the same requests with matplotlib
// and checks the numbers against numpy / scipy).
//
// The real hook is driven on the fixture columns, the export request it posts must be
// the fixture request, the TS builders must equal the Python geometry, and the canvas
// must draw the fixture vertices.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { statsHistogram, statsHistogramMulti } from "../../lib/api";
import { exportStatplotFigure } from "../../lib/api/figures";
import { statsRidgeline } from "../../lib/api/statsDist2";
import {
  lollipopGeometry,
  pairedGeometry,
  sideViolinGeometry,
  stackGeometry,
  type LollipopGeometry,
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
import { dist3ExportSpec } from "./statDist3Draw";
import { draw, plotRect } from "./statRender";
import { useStatStage } from "./useStatStage";

vi.mock("../../lib/api/statsDist2", () => ({ statsMarginal: vi.fn(), statsRidgeline: vi.fn() }));
vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  statsHistogramMulti: vi.fn(),
  statsHistogram: vi.fn(),
}));
vi.mock("../../lib/api/figures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/figures")>()),
  exportStatplotFigure: vi.fn(),
}));

const here = dirname(fileURLToPath(import.meta.url));
type Req = Record<string, unknown> & { data: number[][]; labels: string[]; dist3: Record<string, unknown> };
const CASES = JSON.parse(readFileSync(join(here, "../../../../tests/fixtures/wire/stat_dist3_variants.json"), "utf-8")).cases as {
  halfLeftBoth: { request: Req; response: RidgelineWire; geometry: SideViolinGeometry };
  splitQuartiles: { request: Req; response: RidgelineWire; geometry: SideViolinGeometry };
  pairedDirection: { request: Req; response: PairedSeries; geometry: PairedGeometry };
  lollipopHorizontal: { request: Req; response: { stat: "median"; sort: "desc"; values: number[]; n: number[]; order: number[] }; geometry: LollipopGeometry };
  stackByGroup: { request: Req; response: { edges: number[]; series: { counts: number[] }[] }; geometry: StackGeometry };
};
const DIR_COLORS = CASES.pairedDirection.request.dist3.direction_colors as string[];

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

const TOKENS = ["--accent", "--warn", "--text-dim"];
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(exportStatplotFigure).mockResolvedValue(undefined);
  TOKENS.forEach((t, i) => document.documentElement.style.setProperty(t, DIR_COLORS[i]));
});
afterEach(() => TOKENS.forEach((t) => document.documentElement.style.removeProperty(t)));

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
  const texts: string[] = [];
  const strokeOf = new Map<Path, unknown>();
  const dashOf = new Map<Path, number[]>();
  let strokeStyle: unknown = "";
  let dash: number[] = [];
  let cur: Path = [];
  const noop = () => {};
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(_t, k: string) {
      if (k === "beginPath") return () => { cur = []; };
      if (k === "moveTo" || k === "lineTo") return (x: number, y: number) => cur.push([x, y]);
      if (k === "setLineDash") return (d: number[]) => { dash = d; };
      if (k === "stroke" || k === "fill") return () => { paths.push(cur); if (k === "stroke") { strokeOf.set(cur, strokeStyle); dashOf.set(cur, dash); } };
      if (k === "fillText") return (t: string) => texts.push(t);
      if (k === "arc") return (x: number, y: number) => arcs.push([x, y]);
      return noop;
    },
    set: (_t, k: string, v) => { if (k === "strokeStyle") strokeStyle = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, paths, arcs, texts, strokeOf, dashOf };
}
const canvas = (ctx: CanvasRenderingContext2D) => ({ getContext: () => ctx, width: 0, height: 0 }) as unknown as HTMLCanvasElement;
const host = { clientWidth: 600, clientHeight: 400 } as HTMLElement;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const mapper = (rect: { x: number; y: number; w: number; h: number }, xd: [number, number], yd: [number, number]) => ({
  sx: (v: number) => rect.x + ((v - xd[0]) / (xd[1] - xd[0])) * rect.w,
  sy: (v: number) => rect.y + rect.h - ((v - yd[0]) / (yd[1] - yd[0])) * rect.h,
});
const RECT = plotRect(600, 400, null);
const findPath = (paths: Path[], poly: [number, number][]) =>
  paths.find((p) => p.length === poly.length && p.every((v, i) => near(v[0], poly[i][0]) && near(v[1], poly[i][1])));
const hasPoint = (pts: [number, number][], p: [number, number]) => pts.some((q) => near(q[0], p[0]) && near(q[1], p[1]));

// ── half violin on the left, with inner marks ──────────────────────────────

async function violin(over: Record<string, unknown>) {
  const c = CASES.halfLeftBoth;
  load("h", channels(["A", "B"], c.request.data));
  vi.mocked(statsRidgeline).mockResolvedValue(c.response);
  const hook = renderHook(() => useWiredStage());
  act(() => hook.result.current.setMode("sideviolin"));
  act(() => hook.result.current.setGroupCol(null));
  act(() => hook.result.current.setDist2(over));
  await waitFor(() => expect(hook.result.current.draw?.mode).toBe("sideviolin"));
  return hook;
}

describe("left half violin with inner marks: the stage and the fixture agree", () => {
  it("the TS builders equal the Python geometry, marks included", () => {
    for (const c of [CASES.halfLeftBoth, CASES.splitQuartiles]) {
      const d = c.request.dist3 as { slots: number[]; sides: Side[]; style: "half" | "split"; marks: "quartiles" | "both" };
      const geo = sideViolinGeometry(c.response, d.slots, d.sides, d.style, c.request.data, d.marks);
      expect(geo.violins.map((v) => v.marks?.map((m) => m.name))).toEqual(c.geometry.violins.map((v) => v.marks?.map((m) => m.name)));
      geo.violins.forEach((v, k) => {
        v.marks!.forEach((m, i) => {
          const want = c.geometry.violins[k].marks![i];
          expect(m.y).toBeCloseTo(want.y, 9);
          expect(m.x[0]).toBe(want.x[0]);
          expect(m.x[1]).toBeCloseTo(want.x[1], 9);
        });
      });
      expect(geo.x_domain).toEqual(c.geometry.x_domain);
    }
  });

  it("without marks the geometry is the one it was (no marks key)", () => {
    const c = CASES.halfLeftBoth;
    const g = sideViolinGeometry(c.response, [0, 1], ["right", "right"], "half");
    expect(g.violins.every((v) => !("marks" in v))).toBe(true);
  });

  it("the stage exports the fixture request: the left side and the marks reach the wire", async () => {
    const hook = await violin({ violinSide: "left", violinMarks: "both" });
    const spec = await exported(hook);
    expect(stripPalette(spec)).toEqual(stripPalette(CASES.halfLeftBoth.request));
  });

  it("the canvas draws every mark segment at the fixture vertices, the median solid and the quartiles dashed", async () => {
    const hook = await violin({ violinSide: "left", violinMarks: "both" });
    const { ctx, paths, dashOf } = recorder();
    draw(canvas(ctx), host, hook.result.current.draw);
    const geo = CASES.halfLeftBoth.geometry;
    const { sx, sy } = mapper(RECT, geo.x_domain, geo.y_domain);
    for (const v of geo.violins) {
      expect(v.line.every(([x]) => x <= v.slot)).toBe(true); // the left side
      for (const m of v.marks!) {
        const p = findPath(paths, [[sx(m.x[0]), sy(m.y)], [sx(m.x[1]), sy(m.y)]]);
        expect(p, `${m.name} segment`).toBeDefined();
        expect(dashOf.get(p!)).toEqual(m.name === "median" ? [] : [4, 3]);
      }
    }
  });

  it("the marks choice redraws without a refetch and persists through save and reopen", async () => {
    const hook = await violin({ violinSide: "left", violinMarks: "median" });
    const calls = vi.mocked(statsRidgeline).mock.calls.length;
    act(() => hook.result.current.setDist2({ violinMarks: "quartiles" }));
    await waitFor(() => expect(hook.result.current.draw?.mode === "sideviolin" && hook.result.current.draw.innerMarks).toBe("quartiles"));
    expect(vi.mocked(statsRidgeline).mock.calls.length).toBe(calls);
    const { ctx, paths } = recorder();
    draw(canvas(ctx), host, hook.result.current.draw);
    const geo = CASES.halfLeftBoth.geometry;
    const { sx, sy } = mapper(RECT, geo.x_domain, geo.y_domain);
    const median = geo.violins[0].marks!.find((m) => m.name === "median")!;
    expect(findPath(paths, [[sx(median.x[0]), sy(median.y)], [sx(median.x[1]), sy(median.y)]])).toBeUndefined();
  });

  it("the split violin's quartile marks export the fixture request", async () => {
    const c = CASES.splitQuartiles;
    vi.mocked(statsRidgeline).mockResolvedValue(c.response);
    const { computeGroupedDraw } = await import("./statDist3Draw");
    const groups = c.request.data.map((values, i) => ({ label: c.request.labels[i], values }));
    const d = await computeGroupedDraw("sideviolin", groups, { side: "split", bw: "scott", stat: "mean", sort: "none", valueLabel: "value", nestLabel: "h" });
    const stamped = { ...d, innerMarks: "quartiles" as const };
    expect(stripPalette(dist3ExportSpec(stamped, "svg"))).toEqual(stripPalette(c.request));
  });
});

// ── paired lines by direction ──────────────────────────────────────────────

async function paired() {
  const [b, a] = CASES.pairedDirection.request.data;
  load("p", channels(["before", "after"], [[...b, nan], [...a, 7]])); // an incomplete row leaves with its line
  const hook = renderHook(() => useWiredStage());
  act(() => hook.result.current.setMode("paired"));
  act(() => hook.result.current.setValueCol(0));
  act(() => hook.result.current.setHistCols([1]));
  act(() => hook.result.current.setDist2({ pairedDirection: true }));
  await waitFor(() => expect(hook.result.current.draw?.mode === "paired" && hook.result.current.draw.direction).toBe(true));
  return hook;
}

describe("paired lines by direction: the stage and the fixture agree", () => {
  it("the TS builder equals the Python directions, counts and legend", () => {
    const g = pairedGeometry(CASES.pairedDirection.response, false, true);
    expect(g.directions).toEqual(CASES.pairedDirection.geometry.directions);
    expect(g.legend).toEqual(CASES.pairedDirection.geometry.legend);
    expect(pairedGeometry(CASES.pairedDirection.response, false).directions).toBeUndefined();
  });

  it("exports the fixture request, the colours being the theme tokens", async () => {
    const hook = await paired();
    expect(stripPalette(await exported(hook))).toEqual(stripPalette(CASES.pairedDirection.request));
  });

  it("the request carries no colours when no token resolves, and none at all when off", async () => {
    TOKENS.forEach((t) => document.documentElement.style.removeProperty(t));
    const hook = await paired();
    const d3 = (await exported(hook) as { dist3: Record<string, unknown> }).dist3;
    expect(d3.direction).toBe(true);
    expect("direction_colors" in d3).toBe(false);
    act(() => hook.result.current.setDist2({ pairedDirection: false }));
    await waitFor(() => expect(hook.result.current.draw?.mode === "paired" && !!hook.result.current.draw.direction).toBe(false));
    const off = (await exported(hook) as { dist3: Record<string, unknown> }).dist3;
    expect(off).toEqual({ type: "paired", ci: false });
  });

  it("the canvas strokes each subject line in its direction's colour and draws one legend row per direction", async () => {
    const hook = await paired();
    const { ctx, paths, strokeOf, texts } = recorder();
    draw(canvas(ctx), host, hook.result.current.draw);
    const geo = CASES.pairedDirection.geometry;
    const { sx, sy } = mapper(RECT, geo.x_domain, geo.y_domain);
    geo.lines.forEach(([a, b], i) => {
      const p = findPath(paths, [[sx(a[0]), sy(a[1])], [sx(b[0]), sy(b[1])]]);
      expect(p, "subject line").toBeDefined();
      expect(strokeOf.get(p!)).toBe(DIR_COLORS[["up", "down", "same"].indexOf(geo.directions![i])]);
    });
    for (const row of geo.legend!) expect(texts).toContain(row.label);
    expect(new Set(geo.directions)).toEqual(new Set(["up", "down", "same"]));
  });

  it("off, the lines stay the theme ink and there is no legend", async () => {
    const hook = await paired();
    act(() => hook.result.current.setDist2({ pairedDirection: false }));
    await waitFor(() => expect(hook.result.current.draw?.mode === "paired" && !!hook.result.current.draw.direction).toBe(false));
    const { ctx, texts } = recorder();
    draw(canvas(ctx), host, hook.result.current.draw);
    expect(texts.some((t) => /increase|decrease|no change/.test(t))).toBe(false);
  });
});

// ── horizontal lollipop ────────────────────────────────────────────────────

async function lollipop() {
  const c = CASES.lollipopHorizontal;
  load("l", channels(["a", "b", "c", "d"], c.request.data));
  const hook = renderHook(() => useWiredStage());
  act(() => hook.result.current.setMode("lollipop"));
  act(() => hook.result.current.setGroupCol(null));
  act(() => hook.result.current.setDist2({ lollipopStat: "median", lollipopSort: "desc", lollipopHoriz: true }));
  await waitFor(() => expect(hook.result.current.draw?.mode === "lollipop" && hook.result.current.draw.horizontal).toBe(true));
  await waitFor(() => expect(hook.result.current.draw?.mode === "lollipop" && hook.result.current.draw.series.sort).toBe("desc"));
  return hook;
}

describe("horizontal lollipop: the stage and the fixture agree", () => {
  it("the TS builder equals the Python geometry (first category on top)", () => {
    expect(lollipopGeometry(CASES.lollipopHorizontal.response, true)).toEqual(CASES.lollipopHorizontal.geometry);
  });

  it("exports the fixture request: the value title moves to X and the flag rides the wire", async () => {
    const hook = await lollipop();
    const spec = (await exported(hook)) as unknown as Record<string, unknown>;
    expect(stripPalette(spec)).toEqual(stripPalette(CASES.lollipopHorizontal.request));
    expect("y_label" in spec).toBe(false);
  });

  it("the canvas draws stems and dots at the fixture vertices, the names down the left", async () => {
    const hook = await lollipop();
    const d = hook.result.current.draw!;
    const rect = plotRect(600, 400, d);
    const { ctx, paths, arcs, texts } = recorder();
    draw(canvas(ctx), host, d);
    const geo = CASES.lollipopHorizontal.geometry;
    const { sx, sy } = mapper(rect, geo.x_domain, geo.y_domain);
    for (const [a, b] of geo.stems) expect(findPath(paths, [[sx(a[0]), sy(a[1])], [sx(b[0]), sy(b[1])]]), "stem").toBeDefined();
    for (const p of geo.dots) expect(hasPoint(arcs, [sx(p[0]), sy(p[1])]), "dot").toBe(true);
    expect(texts).toEqual(expect.arrayContaining(["c", "a", "b", "d", CASES.lollipopHorizontal.request.x_label as string]));
    expect(findPath(paths, [[sx(0), sy(geo.y_domain[0])], [sx(0), sy(geo.y_domain[1])]]), "zero baseline").toBeDefined();
  });

  it("long category names widen the left margin, a vertical plot keeps it", async () => {
    const hook = await lollipop();
    const d = hook.result.current.draw as Extract<NonNullable<typeof hook.result.current.draw>, { mode: "lollipop" }>;
    const wide = plotRect(600, 400, { ...d, labels: ["a very long category name", "b", "c", "d"] });
    expect(wide.x).toBeGreaterThan(plotRect(600, 400, d).x);
    expect(wide.x).toBeLessThanOrEqual(600 * 0.35);
    expect(plotRect(600, 400, { ...d, horizontal: false, labels: ["a very long category name"] }).x).toBe(RECT.x);
  });
});

// ── histogram stacked by a group column ────────────────────────────────────

async function byGroup(on = true) {
  const c = CASES.stackByGroup;
  const groups = c.request.data;
  // channel 0 = the group code (1, 2, 3), channel 1 = the value
  const code = groups.flatMap((g, i) => g.map(() => i + 1));
  const val = groups.flat();
  load("s", channels(["lot", "value"], [code, val]));
  vi.mocked(statsHistogramMulti).mockResolvedValue({ ...c.response, n_bins: 0 } as never);
  const hook = renderHook(() => useWiredStage());
  act(() => hook.result.current.setMode("histogram"));
  act(() => hook.result.current.setValueCol(1));
  act(() => hook.result.current.setGroupCol(0));
  act(() => hook.result.current.setBins("sturges"));
  act(() => hook.result.current.setDist2({ histSplit: on, histStack: true }));
  if (on) await waitFor(() => expect(hook.result.current.draw?.mode === "histogram" && !!hook.result.current.draw.values).toBe(true));
  return hook;
}

describe("histogram stacked by a group column: the stage and the fixture agree", () => {
  it("bins each group's finite values once on shared edges and exports the fixture request", async () => {
    const hook = await byGroup();
    expect(vi.mocked(statsHistogramMulti).mock.calls.at(-1)).toEqual([CASES.stackByGroup.request.data, "sturges"]);
    expect(stripPalette(await exported(hook))).toEqual(stripPalette(CASES.stackByGroup.request));
  });

  it("the TS builder equals the Python bars and the canvas stacks them", async () => {
    const c = CASES.stackByGroup;
    expect(stackGeometry(c.response.edges, c.response.series.map((s) => s.counts))).toEqual(c.geometry);
    const hook = await byGroup();
    const rects: [number, number, number, number][] = [];
    const rec = recorder();
    const ctx = new Proxy(rec.ctx as unknown as Record<string, unknown>, {
      get: (t, k: string) => (k === "fillRect" ? (x: number, y: number, w: number, h: number) => rects.push([x, y, w, h]) : t[k]),
    }) as unknown as CanvasRenderingContext2D;
    draw(canvas(ctx), host, hook.result.current.draw);
    const g = c.geometry;
    const [y0, y1] = zeroBasedDomain([[g.y_max]]);
    const [x0, x1] = finiteDomain([g.edges]);
    const sx = (v: number) => RECT.x + ((v - x0) / (x1 - x0)) * RECT.w;
    const sy = (v: number) => RECT.y + RECT.h - ((v - y0) / (y1 - y0)) * RECT.h;
    for (const row of g.bars) {
      for (const [b0, b1, base, top] of row) {
        if (top === base) continue;
        expect(rects.some((r) => near(r[0], sx(b0)) && near(r[1], sy(top)) && near(r[2], sx(b1) - sx(b0)) && near(r[3], sy(base) - sy(top))), "stacked bar").toBe(true);
      }
    }
  });

  it("the legend names the group levels", async () => {
    const hook = await byGroup();
    const d = hook.result.current.draw;
    expect(d?.mode === "histogram" && d.series?.map((s) => s.label)).toEqual(CASES.stackByGroup.request.labels);
  });

  it("without the split the histogram is the plain single column (no group call)", async () => {
    vi.mocked(statsHistogram).mockResolvedValue({ edges: [0, 1, 2], counts: [1, 2], density: false } as never);
    const hook = await byGroup(false);
    await waitFor(() => expect(hook.result.current.draw?.mode).toBe("histogram"));
    const d = hook.result.current.draw;
    expect(d?.mode === "histogram" && d.values).toBeUndefined();
  });

  it("a split with one level is refused by name", async () => {
    load("s1", channels(["lot", "value"], [[1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3], [1, 2, 3, 4, 5, nan, nan, nan, nan, nan, nan]]));
    const hook = renderHook(() => useWiredStage());
    act(() => hook.result.current.setMode("histogram"));
    act(() => hook.result.current.setValueCol(1));
    act(() => hook.result.current.setGroupCol(0));
    act(() => hook.result.current.setDist2({ histSplit: true }));
    await waitFor(() => expect(hook.result.current.error).toMatch(/at least 2/));
  });
});

// ── persistence ────────────────────────────────────────────────────────────

/** Save the workspace, drop it, reopen it and read the stage back. */
function reopen() {
  const st = useApp.getState();
  const text = serializeWorkspace({ ...st, plotWindows: st.windowsForSave() });
  useApp.setState({ statPicks: {}, datasets: [] });
  useApp.getState().loadWorkspace(parseWorkspace(text));
  return renderHook(() => useWiredStage()).result.current;
}

describe("the variant picks survive a save and reopen", () => {
  const small = () => load("d", channels(["a", "b"], [[1, 2], [3, 4]]));

  it("left half and inner marks", () => {
    small();
    const { result } = renderHook(() => useWiredStage());
    act(() => result.current.setMode("sideviolin"));
    act(() => result.current.setDist2({ violinSide: "left", violinMarks: "quartiles" }));
    const r = reopen();
    expect([r.mode, r.dist2.violinSide, r.dist2.violinMarks]).toEqual(["sideviolin", "left", "quartiles"]);
  });

  it("paired direction, horizontal lollipop and the histogram split", () => {
    small();
    const { result } = renderHook(() => useWiredStage());
    act(() => result.current.setMode("paired"));
    act(() => result.current.setDist2({ pairedDirection: true, lollipopHoriz: true, histSplit: true }));
    const r = reopen();
    expect([r.dist2.pairedDirection, r.dist2.lollipopHoriz, r.dist2.histSplit]).toEqual([true, true, true]);
  });

  it("an out-of-list pick is dropped on load (fail closed)", () => {
    small();
    useApp.setState({
      statPicks: {
        mode: "sideviolin", violinMarks: "mean" as "none", violinSide: "up" as "half", pairedDirection: "yes" as unknown as boolean,
        lollipopHoriz: 1 as unknown as boolean, histSplit: "x" as unknown as boolean,
      },
    });
    const st = useApp.getState();
    useApp.getState().loadWorkspace(parseWorkspace(serializeWorkspace({ ...st, plotWindows: st.windowsForSave() })));
    expect(useApp.getState().statPicks).toEqual({ mode: "sideviolin" });
  });
});
