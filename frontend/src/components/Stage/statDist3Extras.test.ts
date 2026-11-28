// Plan item 20 extras on the statistics-plot variants: a violin mean marker and raincloud points, a
// paired "no change" tolerance, a 100 % split histogram, lollipop whiskers, and a plain histogram
// drawn per facet panel. Screen <-> export parity, pinned to the shared wire fixture
// `tests/fixtures/wire/stat_dist3_extras.json` (Python half: `tests/test_stat_dist3_extras.py`,
// which draws the same requests with matplotlib and checks the numbers against numpy / scipy).
//
// The real hook is driven on the fixture's own table: the request it posts must be the fixture
// request, the TS builders must equal the Python geometry, and the canvas must draw the fixture
// vertices. The toolbar controls are driven through the real component.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { statsHistogramMulti } from "../../lib/api";
import { exportStatplotFigure } from "../../lib/api/figures";
import { statsRidgeline } from "../../lib/api/statsDist2";
import { lollipopGeometry, lollipopSeries, pairedDirections, pairedGeometry, sideViolinGeometry, stackGeometry } from "../../lib/statDist3";
import { finiteDomain } from "../../lib/statstage";
import type { DataStruct, Dataset } from "../../lib/types";
import { parseWorkspace } from "../../lib/workspace";
import { serializeWorkspace } from "../../lib/workspaceSerialize";
import { setStatPicks } from "../../store/statLevelOptions";
import { useActiveDataset, useApp } from "../../store/useApp";
import StatDist3Controls from "./StatDist3Controls";
import { draw, plotRect } from "./statRender";
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

/* eslint-disable @typescript-eslint/no-explicit-any */
type Facet = { label: string; data: number[][] };
type Case = { request: Record<string, any> & { facets?: Facet[] }; response?: any; geometry?: any; panels?: { response: any; geometry: any }[] };
const here = dirname(fileURLToPath(import.meta.url));
const FIX = JSON.parse(readFileSync(join(here, "../../../../tests/fixtures/wire/stat_dist3_extras.json"), "utf-8")) as {
  table: { labels: string[]; rows: number[][]; cat_levels: Record<string, string[]>; excluded_rows: number[] };
  cases: Record<string, Case>;
};
const TABLE = FIX.table;
const C = FIX.cases;
const DIR_COLORS = ["#7c5cff", "#e8a33d", "#8a8a96"];
const TOKENS = ["--accent", "--warn", "--text-dim"];
const col = (name: string) => TABLE.labels.indexOf(name);

const data: DataStruct = {
  time: TABLE.rows.map((_, i) => i),
  values: TABLE.rows,
  labels: TABLE.labels,
  units: TABLE.labels.map(() => ""),
  metadata: {},
  cat_levels: Object.fromEntries(TABLE.labels.flatMap((l, i) => (TABLE.cat_levels[l] ? [[i, TABLE.cat_levels[l]]] : []))),
};
const dataset: Dataset = { id: "x", name: "extras.csv", data, excludedRows: TABLE.excluded_rows };

const stripPalette = (r: unknown) => {
  const { palette: _p, ...rest } = r as Record<string, unknown>;
  return rest;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function useWiredStage() {
  return useStatStage({
    active: useActiveDataset(), yKeys: null, xKey: null, seriesOrder: null, seed: null,
    onSeedConsumed: () => {}, picks: useApp((s) => s.statPicks), onPicksChange: setStatPicks,
  });
}

/** The backend's answer to a call is the fixture response of the case / panel whose rows it was sent. */
function answer(values: number[][], pick: (r: any) => boolean = () => true) {
  for (const c of Object.values(C)) {
    if (c.request.facets) {
      const i = c.request.facets.findIndex((f: Facet) => same(f.data, values));
      if (i >= 0 && pick(c.request)) return c.panels![i].response;
    }
    if (!c.request.facets && same(c.request.data, values) && pick(c.request)) return c.response;
  }
  throw new Error("no fixture response for these rows");
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(exportStatplotFigure).mockResolvedValue(undefined);
  vi.mocked(statsRidgeline).mockImplementation((async (values: number[][]) => answer(values, (r) => r.kind === "sideviolin")) as never);
  vi.mocked(statsHistogramMulti).mockImplementation((async (columns: number[][]) => answer(columns, (r) => r.kind === "histogram")) as never);
  TOKENS.forEach((t, i) => document.documentElement.style.setProperty(t, DIR_COLORS[i]));
  const init = useApp.getInitialState();
  useApp.setState({
    datasets: [dataset], activeId: "x", statMode: true, statPicks: {},
    plotWindows: init.plotWindows, focusedWindowId: init.focusedWindowId, history: [], future: [],
  });
});
afterEach(() => TOKENS.forEach((t) => document.documentElement.style.removeProperty(t)));

type Hook = { result: { current: ReturnType<typeof useStatStage> } };
const exported = async (hook: Hook) => {
  await act(async () => {
    await hook.result.current.exportFigure("svg");
  });
  return vi.mocked(exportStatplotFigure).mock.calls.at(-1)![0];
};

/** The stage on the table with a case's picks (and, for a facet case, facet column = site). */
async function stage(name: string): Promise<Hook> {
  const hook = renderHook(() => useWiredStage());
  const s = () => hook.result.current;
  const grp = col("grp");
  const setup: Record<string, () => void> = {
    violinMeanRain: () => { s().setMode("sideviolin"); s().setValueCol(col("value")); s().setGroupCol(grp); s().setDist2({ violinMean: true, violinRain: true }); },
    pairedTol: () => { s().setMode("paired"); s().setValueCol(col("before")); s().setHistCols([col("after")]); s().setDist2({ pairedDirection: true, pairedTol: 0.5 }); },
    lollipopWhisker: () => { s().setMode("lollipop"); s().setValueCol(col("value")); s().setGroupCol(grp); s().setDist2({ lollipopStat: "mean", lollipopSort: "desc", lollipopHoriz: true, lollipopWhisker: "ci" }); },
    stackPercent: () => { s().setMode("histogram"); s().setValueCol(col("value")); s().setGroupCol(grp); s().setBins("sturges"); s().setDist2({ histSplit: true, histStack: true, histPercent: true }); },
    plainHistogram: () => { s().setMode("histogram"); s().setValueCol(col("value")); s().setBins("sturges"); },
  };
  const key = name.startsWith("facet") ? name.charAt(5).toLowerCase() + name.slice(6) : name;
  act(() => setup[key === "plainHistogram" ? "plainHistogram" : key]());
  if (name.startsWith("facet")) {
    act(() => s().setFacetCol(col("site")));
    await waitFor(() => expect(s().drawFacets?.length).toBe(2));
  } else {
    await waitFor(() => expect(s().draw).not.toBeNull());
  }
  // let the stamped options settle
  await waitFor(() => expect(s().busy).toBe(false));
  return hook;
}

// -- canvas recorder --------------------------------------------------------------

type Path = [number, number][];
function recorder() {
  const paths: Path[] = [];
  const arcs: [number, number][] = [];
  const texts: string[] = [];
  const rects: number[][] = [];
  const strokeOf = new Map<Path, unknown>();
  let strokeStyle: unknown = "";
  let cur: Path = [];
  const noop = () => {};
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(_t, k: string) {
      if (k === "beginPath") return () => { cur = []; };
      if (k === "moveTo" || k === "lineTo") return (x: number, y: number) => cur.push([x, y]);
      if (k === "stroke" || k === "fill") return () => { paths.push(cur); if (k === "stroke") strokeOf.set(cur, strokeStyle); };
      if (k === "fillText") return (t: string) => texts.push(t);
      if (k === "arc") return (x: number, y: number) => arcs.push([x, y]);
      if (k === "fillRect") return (...a: number[]) => rects.push(a);
      return noop;
    },
    set: (_t, k: string, v) => { if (k === "strokeStyle") strokeStyle = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, paths, arcs, texts, rects, strokeOf };
}
const canvas = (ctx: CanvasRenderingContext2D) => ({ getContext: () => ctx, width: 0, height: 0 }) as unknown as HTMLCanvasElement;
const host = { clientWidth: 600, clientHeight: 400 } as HTMLElement;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const mapper = (rect: { x: number; y: number; w: number; h: number }, xd: [number, number], yd: [number, number]) => ({
  sx: (v: number) => rect.x + ((v - xd[0]) / (xd[1] - xd[0])) * rect.w,
  sy: (v: number) => rect.y + rect.h - ((v - yd[0]) / (yd[1] - yd[0])) * rect.h,
});
const hasPoint = (pts: [number, number][], p: [number, number]) => pts.some((q) => near(q[0], p[0]) && near(q[1], p[1]));
const findPath = (paths: Path[], poly: [number, number][]) =>
  paths.find((p) => p.length === poly.length && p.every((v, i) => near(v[0], poly[i][0]) && near(v[1], poly[i][1])));

// -- violin mean marker and rain -----------------------------------------------------

describe("violin mean marker and rain points", () => {
  it("the TS builder equals the Python geometry, mean and rain included", () => {
    const c = C.violinMeanRain;
    const d = c.request.dist3;
    const geo = sideViolinGeometry(c.response, d.slots, d.sides, d.style, c.request.data, "none", { mean: true, rain: true });
    geo.violins.forEach((v, k) => {
      const want = c.geometry.violins[k];
      expect(v.mean!.x).toBeCloseTo(want.mean.x, 12);
      expect(v.mean!.y).toBeCloseTo(want.mean.y, 12);
      expect(v.rain!.length).toBe(want.rain.length);
      v.rain!.forEach((p, i) => {
        expect(p[0]).toBeCloseTo(want.rain[i][0], 12); // the seeded jitter is the same in both languages
        expect(p[1]).toBe(want.rain[i][1]);
      });
    });
  });

  it("the mean is the arithmetic mean of the group's values", () => {
    const c = C.violinMeanRain;
    const g = sideViolinGeometry(c.response, [0, 1], ["right", "right"], "half", c.request.data, "none", { mean: true });
    (c.request.data as number[][]).forEach((vals, k) => expect(g.violins[k].mean!.y).toBeCloseTo(vals.reduce((s, x) => s + x, 0) / vals.length, 12));
  });

  it("off, the geometry carries neither; a split violin refuses rain", () => {
    const c = C.violinMeanRain;
    const g = sideViolinGeometry(c.response, [0, 1], ["right", "right"], "half", c.request.data);
    expect(g.violins.every((v) => !("mean" in v) && !("rain" in v))).toBe(true);
    expect(() => sideViolinGeometry(c.response, [0, 0], ["left", "right"], "split", c.request.data, "none", { rain: true })).toThrow(/half violin/);
  });

  it("the stage exports the fixture request and draws the rain at the fixture vertices", async () => {
    const hook = await stage("violinMeanRain");
    expect(stripPalette(await exported(hook))).toEqual(stripPalette(C.violinMeanRain.request));
    const d = hook.result.current.draw!;
    const { ctx, arcs } = recorder();
    draw(canvas(ctx), host, d);
    const geo = C.violinMeanRain.geometry;
    const { sx, sy } = mapper(plotRect(600, 400, d), geo.x_domain, geo.y_domain);
    for (const v of geo.violins) for (const p of v.rain) expect(hasPoint(arcs, [sx(p[0]), sy(p[1])]), "rain point").toBe(true);
  });

  it("toggling the options redraws without a refetch; a split violin draws and exports no rain", async () => {
    const hook = await stage("violinMeanRain");
    const calls = vi.mocked(statsRidgeline).mock.calls.length;
    act(() => hook.result.current.setDist2({ violinRain: false }));
    await waitFor(() => expect(hook.result.current.draw?.mode === "sideviolin" && !!hook.result.current.draw.rain).toBe(false));
    expect(vi.mocked(statsRidgeline).mock.calls.length).toBe(calls);
    const dist3 = ((await exported(hook)) as unknown as { dist3: Record<string, unknown> }).dist3;
    expect(dist3.mean).toBe(true);
    expect("rain" in dist3).toBe(false);
  });
});

// -- paired tolerance -----------------------------------------------------------------

describe("paired no-change tolerance", () => {
  it("the TS directions and legend equal the Python ones (the boundary counts as no change)", () => {
    const c = C.pairedTol;
    const g = pairedGeometry(c.response, false, true, 0.5);
    expect(g.directions).toEqual(c.geometry.directions);
    expect(g.legend).toEqual(c.geometry.legend);
    const [b, a] = c.request.data as number[][];
    const d = a.map((v, i) => v - b[i]);
    const n = (f: (x: number) => boolean) => d.filter(f).length;
    expect(g.legend!.map((r) => r.label)).toEqual([`increase (${n((x) => x > 0.5)})`, `decrease (${n((x) => x < -0.5)})`, `no change (${n((x) => Math.abs(x) <= 0.5)})`]);
  });

  it("a zero tolerance is the exact comparison, and a bad one is refused", () => {
    expect(pairedDirections([1, 2, 3], [1, 3, 2])).toEqual(["same", "up", "down"]);
    expect(pairedDirections([1, 2, 3], [1, 3, 2], 0)).toEqual(["same", "up", "down"]);
    expect(pairedDirections([1, 2, 3], [1.4, 3, 2], 0.5)).toEqual(["same", "up", "down"]);
    expect(() => pairedDirections([1], [2], -1)).toThrow(/tolerance/);
  });

  it("the stage exports the fixture request, and the canvas colours each line by the tolerant direction", async () => {
    const hook = await stage("pairedTol");
    expect(stripPalette(await exported(hook))).toEqual(stripPalette(C.pairedTol.request));
    const d = hook.result.current.draw!;
    const { ctx, paths, strokeOf, texts } = recorder();
    draw(canvas(ctx), host, d);
    const geo = C.pairedTol.geometry;
    const { sx, sy } = mapper(plotRect(600, 400, d), geo.x_domain, geo.y_domain);
    (geo.lines as number[][][]).forEach(([a, b], i) => {
      const p = findPath(paths, [[sx(a[0]), sy(a[1])], [sx(b[0]), sy(b[1])]]);
      expect(strokeOf.get(p!)).toBe(DIR_COLORS[["up", "down", "same"].indexOf(geo.directions[i])]);
    });
    for (const r of geo.legend) expect(texts).toContain(r.label);
  });

  it("a zero tolerance posts no tol, and without direction there is none either", async () => {
    const hook = await stage("pairedTol");
    act(() => hook.result.current.setDist2({ pairedTol: 0 }));
    await waitFor(() => expect(hook.result.current.draw?.mode === "paired" && hook.result.current.draw.tol).toBe(0));
    expect("tol" in ((await exported(hook)) as unknown as { dist3: object }).dist3).toBe(false);
  });
});

// -- 100 % split histogram -------------------------------------------------------------

describe("100 % split histogram", () => {
  it("the TS builder equals the Python fractions", () => {
    const c = C.stackPercent;
    const g = stackGeometry(c.response.edges, (c.response.series as { counts: number[] }[]).map((s) => s.counts), true);
    expect(g.y_max).toBe(100);
    g.bars.forEach((row, k) => row.forEach((bar, i) => bar.forEach((v, j) => expect(v).toBeCloseTo(c.geometry.bars[k][i][j], 10))));
    expect(stackGeometry([0, 1, 2], [[2, 0], [2, 0]], true).bars[1]).toEqual([[0, 1, 50, 100], [1, 2, 0, 0]]);
    expect(stackGeometry([0, 1, 2], [[2, 0], [2, 0]]).y_max).toBe(4); // off: the counts as before
  });

  it("the stage exports the fixture request (percent, retitled axis) and the canvas draws the percent bars", async () => {
    const hook = await stage("stackPercent");
    expect(stripPalette(await exported(hook))).toEqual(stripPalette(C.stackPercent.request));
    const d = hook.result.current.draw!;
    const { ctx, rects, texts } = recorder();
    draw(canvas(ctx), host, d);
    expect(texts).toContain("percent");
    const g = C.stackPercent.geometry;
    const rect = plotRect(600, 400, d);
    const [x0, x1] = finiteDomain([g.edges]);
    const sx = (v: number) => rect.x + ((v - x0) / (x1 - x0)) * rect.w;
    const sy = (v: number) => rect.y + rect.h - (v / 105) * rect.h;
    for (const row of g.bars) {
      for (const [b0, b1, base, top] of row as number[][]) {
        if (top === base) continue;
        expect(rects.some((r) => near(r[0], sx(b0)) && near(r[1], sy(top)) && near(r[2], sx(b1) - sx(b0)) && near(r[3], sy(base) - sy(top))), "percent bar").toBe(true);
      }
    }
  });

  it("percent only counts while stacked: clearing the stack exports a plain overlay", async () => {
    const hook = await stage("stackPercent");
    act(() => hook.result.current.setDist2({ histStack: false }));
    await waitFor(() => expect(hook.result.current.draw?.mode === "histogram" && !!hook.result.current.draw.percent).toBe(false));
    const spec = (await exported(hook)) as unknown as Record<string, unknown>;
    expect(spec.dist3).toBeUndefined();
    expect(spec.y_label).toBe("count");
  });
});

// -- lollipop whiskers -------------------------------------------------------------------

describe("lollipop whiskers", () => {
  it("the TS series and geometry equal the Python ones", () => {
    const c = C.lollipopWhisker;
    const r = lollipopSeries(c.request.data, "mean", "desc", "ci");
    r.half!.forEach((h, i) => expect(h!).toBeCloseTo(c.response.half[i], 12));
    const g = lollipopGeometry(r, true);
    expect(g.legend).toBe(c.geometry.legend);
    g.whiskers!.forEach((w, i) => w.forEach((p, j) => p.forEach((v, m) => expect(v).toBeCloseTo(c.geometry.whiskers[i][j][m], 10))));
    expect(lollipopGeometry(lollipopSeries(c.request.data, "mean", "desc"), true).whiskers).toBeUndefined();
  });

  it("a group of one value has no whisker, and a median refuses them", () => {
    const g = lollipopGeometry(lollipopSeries([[1, 2, 3], [4]], "mean", "none", "sd"));
    expect(g.whiskers).toHaveLength(1);
    expect(g.legend).toBe("mean ± SD; none for one value");
    expect(() => lollipopSeries([[1, 2]], "median", "none", "sd")).toThrow(/mean only/);
  });

  it("the stage exports the fixture request and the canvas draws every whisker and names them", async () => {
    const hook = await stage("lollipopWhisker");
    expect(stripPalette(await exported(hook))).toEqual(stripPalette(C.lollipopWhisker.request));
    const d = hook.result.current.draw!;
    const { ctx, paths, texts } = recorder();
    draw(canvas(ctx), host, d);
    const geo = C.lollipopWhisker.geometry;
    const { sx, sy } = mapper(plotRect(600, 400, d), geo.x_domain, geo.y_domain);
    for (const [a, b] of geo.whiskers) expect(findPath(paths, [[sx(a[0]), sy(a[1])], [sx(b[0]), sy(b[1])]]), "whisker").toBeDefined();
    expect(texts).toContain(geo.legend);
  });

  it("switching to the median draws and exports none, and says why", async () => {
    const hook = await stage("lollipopWhisker");
    act(() => hook.result.current.setDist2({ lollipopStat: "median" }));
    await waitFor(() => expect(hook.result.current.draw?.mode === "lollipop" && hook.result.current.draw.series.stat).toBe("median"));
    const d = hook.result.current.draw!;
    expect(d.mode === "lollipop" && d.series.whisker).toBeUndefined();
    expect("whisker" in ((await exported(hook)) as unknown as { dist3: object }).dist3).toBe(false);
    const { variantNotes } = await import("./StatDist3Controls");
    expect(variantNotes({ ...hook.result.current, fit: null }, { breaks: false, inset: false }).join(" ")).toMatch(/mean only/);
  });
});

// -- under facets ----------------------------------------------------------------------------

describe("each option under facet by", () => {
  it.each(["facetViolinMeanRain", "facetPairedTol", "facetLollipopWhisker", "facetStackPercent", "facetPlainHistogram"])(
    "%s: the stage posts the fixture request, one panel per level",
    async (name) => {
      const hook = await stage(name);
      expect(hook.result.current.draw).toBeNull();
      expect(stripPalette(await exported(hook))).toEqual(stripPalette(C[name].request));
    },
  );

  it("the faceted violin draws each panel's rain from that panel's rows", async () => {
    const hook = await stage("facetViolinMeanRain");
    hook.result.current.drawFacets!.forEach((f, i) => {
      expect(f.draw.mode === "sideviolin" && f.draw.rain && f.draw.meanMarker).toBe(true);
      const want = (C.facetViolinMeanRain.panels![i].geometry.violins[0].rain as number[][]).map((p) => p[1]);
      const d = f.draw as Extract<typeof f.draw, { mode: "sideviolin" }>;
      const g = sideViolinGeometry(d.wire, d.positions, d.sides, d.style, d.groups, d.innerMarks, { mean: true, rain: true });
      expect(g.violins[0].rain!.map((p) => p[1])).toEqual(want);
    });
  });

  it("the plain histogram's panels hold their own rows' bins, and a rug or fit says it is not drawn", async () => {
    const hook = await stage("facetPlainHistogram");
    hook.result.current.drawFacets!.forEach((f, i) => {
      const d = f.draw;
      expect(d.mode === "histogram" && d.values).toEqual(C.facetPlainHistogram.request.facets![i].data);
      expect(d.mode === "histogram" && d.series?.map((s) => s.counts)).toEqual((C.facetPlainHistogram.panels![i].response.series as { counts: number[] }[]).map((s) => s.counts));
    });
    act(() => hook.result.current.setFit("norm"));
    const { variantNotes } = await import("./StatDist3Controls");
    expect(variantNotes({ ...hook.result.current }, { breaks: false, inset: false }).join(" ")).toMatch(/fit is not drawn/);
  });

  it("clearing the facet column restores the flat plain histogram", async () => {
    const hook = await stage("facetPlainHistogram");
    act(() => hook.result.current.setFacetCol(null));
    await waitFor(() => expect(hook.result.current.drawFacets).toBeNull());
  });
});

// -- the toolbar, through the real component ------------------------------------------------------

describe("the toolbar controls", () => {
  function Toolbar() {
    const st = useWiredStage();
    return createElement(StatDist3Controls, { st });
  }
  const setMode = (mode: string, extra: object = {}) =>
    useApp.setState({ statPicks: { mode: mode as "paired", cols: undefined, ...extra } as never });

  it("the mean and rain checkboxes write the picks (rain is hidden on a split violin)", () => {
    setMode("sideviolin");
    render(createElement(Toolbar));
    fireEvent.click(screen.getByLabelText("mean"));
    fireEvent.click(screen.getByLabelText("rain points"));
    expect(useApp.getState().statPicks).toMatchObject({ violinMean: true, violinRain: true });
    act(() => useApp.setState({ statPicks: { mode: "sideviolin", violinSide: "split" } }));
    expect(screen.queryByLabelText("rain points")).toBeNull();
  });

  it("the tolerance field shows with direction on, and commits on Enter", () => {
    setMode("paired", { pairedDirection: true });
    render(createElement(Toolbar));
    const field = screen.getByLabelText("No-change tolerance");
    fireEvent.change(field, { target: { value: "0.25" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(useApp.getState().statPicks.pairedTol).toBe(0.25);
  });

  it("the whiskers select sets the kind and is disabled for a median", () => {
    setMode("lollipop");
    render(createElement(Toolbar));
    fireEvent.change(screen.getByLabelText("whiskers"), { target: { value: "sem" } });
    expect(useApp.getState().statPicks.lollipopWhisker).toBe("sem");
    act(() => useApp.setState({ statPicks: { mode: "lollipop", lollipopStat: "median", lollipopWhisker: "sem" } }));
    expect((screen.getByLabelText("whiskers") as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByText(/Whiskers are drawn for the mean only/)).toBeTruthy();
  });

  it("the 100 % checkbox appears once the histogram is stacked", () => {
    setMode("histogram", { histStack: false, histCols: [1] });
    render(createElement(Toolbar));
    expect(screen.queryByLabelText("100 %")).toBeNull();
    act(() => useApp.setState({ statPicks: { mode: "histogram", histStack: true, histCols: [1] } }));
    fireEvent.click(screen.getByLabelText("100 %"));
    expect(useApp.getState().statPicks.histPercent).toBe(true);
  });
});

// -- persistence -------------------------------------------------------------------------------------

function reopen() {
  const st = useApp.getState();
  const text = serializeWorkspace({ ...st, plotWindows: st.windowsForSave() });
  useApp.setState({ statPicks: {}, datasets: [] });
  useApp.getState().loadWorkspace(parseWorkspace(text));
  return renderHook(() => useWiredStage()).result.current;
}

describe("the picks survive a save and reopen, and bad ones are dropped", () => {
  it("round-trips all five", () => {
    useApp.setState({ statPicks: { mode: "paired", violinMean: true, violinRain: true, pairedTol: 0.25, histPercent: true, lollipopWhisker: "ci" } });
    const r = reopen();
    expect([r.dist2.violinMean, r.dist2.violinRain, r.dist2.pairedTol, r.dist2.histPercent, r.dist2.lollipopWhisker]).toEqual([true, true, 0.25, true, "ci"]);
  });

  it("drops an out-of-range value (fail closed)", () => {
    useApp.setState({
      statPicks: {
        mode: "paired", pairedTol: -1, violinMean: "yes" as unknown as boolean, lollipopWhisker: "range" as "ci", histPercent: 1 as unknown as boolean,
      },
    });
    const st = useApp.getState();
    useApp.getState().loadWorkspace(parseWorkspace(serializeWorkspace({ ...st, plotWindows: st.windowsForSave() })));
    expect(useApp.getState().statPicks).toEqual({ mode: "paired" });
    useApp.setState({ statPicks: { mode: "paired", pairedTol: Number.NaN } });
    const s2 = useApp.getState();
    useApp.getState().loadWorkspace(parseWorkspace(serializeWorkspace({ ...s2, plotWindows: s2.windowsForSave() })));
    expect(useApp.getState().statPicks).toEqual({ mode: "paired" });
  });
});
