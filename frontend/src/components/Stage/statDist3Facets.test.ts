// Plan item 20 variants under "facet by": half / split violin, paired, lollipop and a histogram
// split by a group, one panel per facet level. Screen <-> export parity, pinned to the shared
// wire fixture `tests/fixtures/wire/stat_dist3_facets.json` (Python half:
// `tests/test_stat_dist3_facets.py`, which draws each panel with matplotlib and checks the
// numbers against numpy / scipy).
//
// The real hook is driven on the fixture's own table; the request it posts must be the fixture
// request, every panel's canvas must draw the fixture vertices, and a panel that cannot draw is
// named, never replaced by another panel's rows.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { statsHistogramMulti } from "../../lib/api";
import { exportStatplotFigure } from "../../lib/api/figures";
import { statsRidgeline } from "../../lib/api/statsDist2";
import type { DataStruct, Dataset } from "../../lib/types";
import { setStatPicks } from "../../store/statLevelOptions";
import { useActiveDataset, useApp } from "../../store/useApp";
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
type Panel = { label: string; response: unknown; geometry: Record<string, any> };
type Facet = { label: string; kind: string; data: number[][]; labels: string[]; dist3: Record<string, any> };
type Case = { request: { kind: string; facets: Facet[] } & Record<string, any>; panels: Panel[] };
const here = dirname(fileURLToPath(import.meta.url));
const FIX = JSON.parse(readFileSync(join(here, "../../../../tests/fixtures/wire/stat_dist3_facets.json"), "utf-8")) as {
  table: { labels: string[]; rows: number[][]; cat_levels: Record<string, string[]>; excluded_rows: number[] };
  cases: Record<string, Case>;
};
const TABLE = FIX.table;
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
const dataset: Dataset = { id: "f", name: "facets.csv", data, excludedRows: TABLE.excluded_rows };

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

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(exportStatplotFigure).mockResolvedValue(undefined);
  // the backend's answers are the fixture's per-panel responses, found by the groups sent
  vi.mocked(statsRidgeline).mockImplementation((async (values: number[][]) => {
    for (const c of Object.values(FIX.cases)) {
      const i = c.request.facets.findIndex((f) => same(f.data, values));
      if (i >= 0) return c.panels[i].response;
    }
    throw new Error("no fixture response for these groups");
  }) as never);
  vi.mocked(statsHistogramMulti).mockImplementation((async (columns: number[][]) => {
    const c = FIX.cases.facetStackBySplit;
    const i = c.request.facets.findIndex((f) => same(f.data, columns));
    if (i < 0) throw new Error("no fixture response for these columns");
    return c.panels[i].response;
  }) as never);
  TOKENS.forEach((t, i) => document.documentElement.style.setProperty(t, DIR_COLORS[i]));
  const init = useApp.getInitialState();
  useApp.setState({
    datasets: [dataset], activeId: "f", statMode: true, statPicks: {},
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
const panelsReady = (hook: Hook, n = 2) => waitFor(() => expect(hook.result.current.drawFacets?.length).toBe(n));

/** The stage on the fixture's table, a variant picked, facet column = site. */
async function stage(name: string): Promise<Hook> {
  const hook = renderHook(() => useWiredStage());
  const s = () => hook.result.current;
  const group = col("grp");
  const setup: Record<string, () => void> = {
    facetHalfLeftBoth: () => { s().setMode("sideviolin"); s().setValueCol(col("value")); s().setGroupCol(group); s().setDist2({ violinSide: "left", violinMarks: "both" }); },
    facetSplitQuartiles: () => { s().setMode("sideviolin"); s().setValueCol(col("value")); s().setGroupCol(group); s().setGroup2Col(col("sub")); s().setDist2({ violinSide: "split", violinMarks: "quartiles" }); },
    facetPairedDirection: () => { s().setMode("paired"); s().setValueCol(col("before")); s().setHistCols([col("after")]); s().setDist2({ pairedCi: true, pairedDirection: true }); },
    facetLollipopHorizontal: () => { s().setMode("lollipop"); s().setValueCol(col("value")); s().setGroupCol(group); s().setDist2({ lollipopStat: "median", lollipopSort: "desc", lollipopHoriz: true }); },
    facetStackBySplit: () => { s().setMode("histogram"); s().setValueCol(col("value")); s().setGroupCol(group); s().setBins("sturges"); s().setDist2({ histSplit: true, histStack: true }); },
  };
  act(() => setup[name]());
  act(() => s().setFacetCol(col("site")));
  await panelsReady(hook);
  return hook;
}

// -- canvas recorder ------------------------------------------------------------

type Path = [number, number][];
function recorder() {
  const paths: Path[] = [];
  const texts: string[] = [];
  const strokeOf = new Map<Path, unknown>();
  let strokeStyle: unknown = "";
  let cur: Path = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(_t, k: string) {
      if (k === "beginPath") return () => { cur = []; };
      if (k === "moveTo" || k === "lineTo") return (x: number, y: number) => cur.push([x, y]);
      if (k === "stroke" || k === "fill") return () => { paths.push(cur); if (k === "stroke") strokeOf.set(cur, strokeStyle); };
      if (k === "fillText") return (t: string) => texts.push(t);
      return () => {};
    },
    set: (_t, k: string, v) => { if (k === "strokeStyle") strokeStyle = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, paths, texts, strokeOf };
}
const canvas = (ctx: CanvasRenderingContext2D) => ({ getContext: () => ctx, width: 0, height: 0 }) as unknown as HTMLCanvasElement;
const host = { clientWidth: 600, clientHeight: 400 } as HTMLElement;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const RECT = plotRect(600, 400, null);
const mapper = (xd: [number, number], yd: [number, number]) => ({
  sx: (v: number) => RECT.x + ((v - xd[0]) / (xd[1] - xd[0])) * RECT.w,
  sy: (v: number) => RECT.y + RECT.h - ((v - yd[0]) / (yd[1] - yd[0])) * RECT.h,
});
const findPath = (paths: Path[], poly: [number, number][]) =>
  paths.find((p) => p.length === poly.length && p.every((v, i) => near(v[0], poly[i][0]) && near(v[1], poly[i][1])));

// -- the request: every variant, every panel ------------------------------------

describe("each variant under a facet column posts the fixture request", () => {
  it.each(Object.keys(FIX.cases))("%s", async (name) => {
    const hook = await stage(name);
    expect(stripPalette(await exported(hook))).toEqual(stripPalette(FIX.cases[name].request));
  });

  it("the panels are one per level of the facet column, each from its own rows", async () => {
    const hook = await stage("facetHalfLeftBoth");
    expect(hook.result.current.draw).toBeNull(); // the flat draw gives way to the panels
    const rows = TABLE.rows.map((r, i) => ({ r, i })).filter(({ i }) => !TABLE.excluded_rows.includes(i));
    hook.result.current.drawFacets!.forEach((f, s) => {
      expect(f.label).toBe(TABLE.cat_levels.site[s]);
      const d = f.draw;
      if (d.mode !== "sideviolin") throw new Error(d.mode);
      [0, 1].forEach((g) => {
        const want = rows.filter(({ r }) => r[col("site")] === s && r[col("grp")] === g).map(({ r }) => r[col("value")]);
        expect(d.groups[g]).toEqual(want); // an independent selection of the panel's rows
      });
    });
  });
});

// -- the canvas: each panel draws its own fixture vertices -----------------------

describe("every panel's canvas draws the fixture geometry", () => {
  it("half violin: the mark segments of each panel", async () => {
    const hook = await stage("facetHalfLeftBoth");
    hook.result.current.drawFacets!.forEach((f, s) => {
      const { ctx, paths } = recorder();
      draw(canvas(ctx), host, f.draw);
      const geo = FIX.cases.facetHalfLeftBoth.panels[s].geometry;
      const { sx, sy } = mapper(geo.x_domain, geo.y_domain);
      for (const v of geo.violins) {
        for (const m of v.marks) {
          expect(findPath(paths, [[sx(m.x[0]), sy(m.y)], [sx(m.x[1]), sy(m.y)]]), `panel ${s} ${m.name}`).toBeDefined();
        }
      }
    });
  });

  it("paired: lines stroked by direction in each panel, one legend row per direction with its count", async () => {
    const hook = await stage("facetPairedDirection");
    hook.result.current.drawFacets!.forEach((f, s) => {
      const { ctx, paths, strokeOf, texts } = recorder();
      draw(canvas(ctx), host, f.draw);
      const geo = FIX.cases.facetPairedDirection.panels[s].geometry;
      const { sx, sy } = mapper(geo.x_domain, geo.y_domain);
      (geo.lines as [number[], number[]][]).forEach(([a, b], i) => {
        const p = findPath(paths, [[sx(a[0]), sy(a[1])], [sx(b[0]), sy(b[1])]]);
        expect(p, "subject line").toBeDefined();
        expect(strokeOf.get(p!)).toBe(DIR_COLORS[["up", "down", "same"].indexOf(geo.directions[i])]);
      });
      for (const row of geo.legend) expect(texts).toContain(row.label);
    });
  });

  it("lollipop: stems at the fixture vertices, categories down the left", async () => {
    const hook = await stage("facetLollipopHorizontal");
    hook.result.current.drawFacets!.forEach((f, s) => {
      const { ctx, paths, texts } = recorder();
      draw(canvas(ctx), host, f.draw);
      const geo = FIX.cases.facetLollipopHorizontal.panels[s].geometry;
      const { sx, sy } = mapper(geo.x_domain, geo.y_domain);
      for (const [a, b] of geo.stems) expect(findPath(paths, [[sx(a[0]), sy(a[1])], [sx(b[0]), sy(b[1])]]), "stem").toBeDefined();
      expect(texts).toEqual(expect.arrayContaining(["grp = A", "grp = B"]));
    });
  });

  it("stacked histogram: each panel's counts are the fixture's, stacked", async () => {
    const hook = await stage("facetStackBySplit");
    hook.result.current.drawFacets!.forEach((f, s) => {
      const d = f.draw;
      if (d.mode !== "histogram") throw new Error(d.mode);
      expect(d.stack).toBe(true);
      const want = FIX.cases.facetStackBySplit.panels[s].response as { series: { counts: number[] }[] };
      expect(d.series!.map((x) => x.counts)).toEqual(want.series.map((x) => x.counts));
    });
  });
});

// -- options that never refetch, and clearing the facet ---------------------------

describe("options reach every panel", () => {
  it("toggling the marks restamps all panels without a refetch", async () => {
    const hook = await stage("facetHalfLeftBoth");
    const calls = vi.mocked(statsRidgeline).mock.calls.length;
    act(() => hook.result.current.setDist2({ violinMarks: "median" }));
    await waitFor(() =>
      expect(hook.result.current.drawFacets!.every((f) => f.draw.mode === "sideviolin" && f.draw.innerMarks === "median")).toBe(true),
    );
    expect(vi.mocked(statsRidgeline).mock.calls.length).toBe(calls);
  });

  it("clearing the facet column gives back the flat plot and its own request", async () => {
    const hook = await stage("facetPairedDirection");
    act(() => hook.result.current.setFacetCol(null));
    await waitFor(() => expect(hook.result.current.draw?.mode).toBe("paired"));
    expect(hook.result.current.drawFacets).toBeNull();
    const spec = (await exported(hook)) as { facets?: unknown };
    expect(spec.facets).toBeUndefined();
  });
});

// -- a panel that cannot draw is named, never skipped silently --------------------

describe("a panel the plot cannot draw", () => {
  it("is left out and named; the others still draw", async () => {
    const hook = renderHook(() => useWiredStage());
    const s = () => hook.result.current;
    // every row of the second site but one is excluded: that panel has no pair to draw
    const keep = TABLE.rows.findIndex((r) => r[col("site")] === 1);
    const drop = TABLE.rows.map((_, i) => i).filter((i) => TABLE.rows[i][col("site")] === 1 && i !== keep);
    useApp.setState({ datasets: [{ ...dataset, excludedRows: drop }] });
    act(() => { s().setMode("paired"); s().setValueCol(col("before")); s().setHistCols([col("after")]); });
    act(() => s().setFacetCol(col("site")));
    await panelsReady(hook, 1);
    expect(s().drawFacets![0].label).toBe("S1");
    await waitFor(() => expect(s().note).toMatch(/S2: .*at least 2 rows/));
    const spec = (await exported(hook)) as { facets: { label: string }[] };
    expect(spec.facets.map((f) => f.label)).toEqual(["S1"]);
  });

  it("with no panel drawable the stage says why and exports nothing", async () => {
    const hook = renderHook(() => useWiredStage());
    const s = () => hook.result.current;
    // a split violin needs two "then by" levels in every panel: with the column constant there is one
    const constant = { ...data, values: data.values.map((r) => r.map((v, i) => (i === col("sub") ? 0 : v))) };
    useApp.setState({ datasets: [{ ...dataset, data: constant }] });
    act(() => { s().setMode("sideviolin"); s().setValueCol(col("value")); s().setGroupCol(col("grp")); s().setGroup2Col(col("sub")); s().setDist2({ violinSide: "split" }); });
    act(() => s().setFacetCol(col("site")));
    await waitFor(() => expect(s().error).toMatch(/no panel can be drawn/));
    expect(s().error).toMatch(/exactly 2/);
    await act(async () => { await s().exportFigure("svg").catch(() => {}); });
    expect(exportStatplotFigure).not.toHaveBeenCalled();
  });
});
