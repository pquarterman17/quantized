// Plan item 51, Statistics plots: lollipop whisker caps and a ridgeline grid on one density scale.
// Screen <-> export parity, pinned to the shared wire fixture `tests/fixtures/wire/stat_marks_opts.json`
// (Python half: `tests/test_stat_marks_opts.py`, which draws the same requests with matplotlib and
// checks the numbers against numpy / scipy). The real hook is driven on the fixture's own table; the
// toolbar checkboxes are clicked through the real controls.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { createElement, useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportStatplotFigure } from "../../lib/api/figures";
import { statsRidgeline } from "../../lib/api/statsDist2";
import { CAP_HALF, lollipopGeometry, lollipopSeries } from "../../lib/statDist3";
import { ridgelineGeometry } from "../../lib/statRidgeline";
import type { DataStruct, Dataset } from "../../lib/types";
import { parseWorkspace } from "../../lib/workspace";
import { serializeWorkspace } from "../../lib/workspaceSerialize";
import { setStatPicks } from "../../store/statLevelOptions";
import { useActiveDataset, useApp } from "../../store/useApp";
import StatDist2Controls from "./StatDist2Controls";
import StatDist3Controls from "./StatDist3Controls";
import { draw, plotRect } from "./statRender";
import { useStatStage } from "./useStatStage";

vi.mock("../../lib/api/statsDist2", () => ({ statsMarginal: vi.fn(), statsRidgeline: vi.fn() }));
vi.mock("../../lib/api/figures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/figures")>()),
  exportStatplotFigure: vi.fn(),
}));

/* eslint-disable @typescript-eslint/no-explicit-any */
type Facet = { data: number[][]; dist3: Record<string, unknown> };
const here = dirname(fileURLToPath(import.meta.url));
const FIX = JSON.parse(readFileSync(join(here, "../../../../tests/fixtures/wire/stat_marks_opts.json"), "utf-8")) as {
  table: { labels: string[]; rows: number[][]; cat_levels: Record<string, string[]>; excluded_rows: number[] };
  cases: Record<string, any>;
};
const TABLE = FIX.table;
const C = FIX.cases;
const col = (name: string) => TABLE.labels.indexOf(name);
const data: DataStruct = {
  time: TABLE.rows.map((_, i) => i), values: TABLE.rows, labels: TABLE.labels, units: TABLE.labels.map(() => ""), metadata: {},
  cat_levels: Object.fromEntries(TABLE.labels.flatMap((l, i) => (TABLE.cat_levels[l] ? [[i, TABLE.cat_levels[l]]] : []))),
};
const dataset: Dataset = { id: "x", name: "marks.csv", data, excludedRows: TABLE.excluded_rows };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const stripPalette = (r: unknown) => {
  const { palette: _p, ...rest } = r as Record<string, unknown>;
  return rest;
};

function useWiredStage() {
  return useStatStage({
    active: useActiveDataset(), yKeys: null, xKey: null, seriesOrder: null, seed: null,
    onSeedConsumed: () => {}, picks: useApp((s) => s.statPicks), onPicksChange: setStatPicks,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(exportStatplotFigure).mockResolvedValue(undefined);
  vi.mocked(statsRidgeline).mockImplementation((async (values: number[][]) => {
    const i = (C.ridgeShared.request.facets as Facet[]).findIndex((f) => same(f.data, values));
    if (i < 0) throw new Error("no fixture response for these rows");
    return C.ridgeShared.panels[i].response;
  }) as never);
  const init = useApp.getInitialState();
  useApp.setState({ datasets: [dataset], activeId: "x", statMode: true, statPicks: {}, plotWindows: init.plotWindows, focusedWindowId: init.focusedWindowId, history: [], future: [] });
});

const exported = async (hook: { result: { current: ReturnType<typeof useStatStage> } }) => {
  await act(async () => {
    await hook.result.current.exportFigure("svg");
  });
  return vi.mocked(exportStatplotFigure).mock.calls.at(-1)![0];
};
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
function recorder() {
  const paths: [number, number][][] = [];
  let cur: [number, number][] = [];
  const noop = () => {};
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(_t, k: string) {
      if (k === "beginPath") return () => { cur = []; };
      if (k === "moveTo" || k === "lineTo") return (x: number, y: number) => cur.push([x, y]);
      if (k === "stroke" || k === "fill") return () => { paths.push(cur); };
      return noop;
    },
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, paths };
}
const canvas = (ctx: CanvasRenderingContext2D) => ({ getContext: () => ctx, width: 0, height: 0 }) as unknown as HTMLCanvasElement;
const host = { clientWidth: 600, clientHeight: 400 } as HTMLElement;
const mapper = (rect: { x: number; y: number; w: number; h: number }, xd: [number, number], yd: [number, number]) => ({
  sx: (v: number) => rect.x + ((v - xd[0]) / (xd[1] - xd[0])) * rect.w,
  sy: (v: number) => rect.y + rect.h - ((v - yd[0]) / (yd[1] - yd[0])) * rect.h,
});
const findPath = (paths: [number, number][][], poly: [number, number][]) =>
  paths.find((p) => p.length === poly.length && p.every((v, i) => near(v[0], poly[i][0]) && near(v[1], poly[i][1])));

async function lollipopStage(name: "lollipopCaps" | "lollipopCapsH", withCaps = true) {
  const hook = renderHook(() => useWiredStage());
  const o = C[name].request.dist3;
  act(() => {
    const s = hook.result.current;
    s.setMode("lollipop"); s.setValueCol(col("value")); s.setGroupCol(col("grp"));
    s.setDist2({ lollipopStat: "mean", lollipopSort: "none", lollipopHoriz: !!o.horizontal, lollipopWhisker: o.whisker, lollipopCaps: withCaps });
  });
  await waitFor(() => expect(hook.result.current.draw).not.toBeNull());
  return hook;
}

describe("lollipop whisker caps", () => {
  it.each(["lollipopCaps", "lollipopCapsH"] as const)("the TS builder equals the Python geometry (%s)", (name) => {
    const c = C[name];
    const d = c.request.dist3;
    const g = lollipopGeometry(lollipopSeries(c.request.data, "mean", "none", d.whisker), !!d.horizontal, true);
    expect(g.caps).toHaveLength(c.geometry.caps.length);
    g.caps!.forEach((seg, i) => seg.forEach((p, j) => p.forEach((v, m) => expect(v).toBeCloseTo(c.geometry.caps[i][j][m], 10))));
    expect(CAP_HALF).toBe(0.15);
  });

  it("off by default, and refused without whiskers", () => {
    const c = C.lollipopCaps;
    expect(lollipopGeometry(lollipopSeries(c.request.data, "mean", "none", "sem")).caps).toBeUndefined();
    expect(() => lollipopGeometry(lollipopSeries(c.request.data, "mean", "none"), false, true)).toThrow(/caps need whiskers/);
  });

  it.each(["lollipopCaps", "lollipopCapsH"] as const)("the stage exports the fixture request and the canvas draws every cap (%s)", async (name) => {
    const hook = await lollipopStage(name);
    expect(stripPalette(await exported(hook))).toEqual(stripPalette(C[name].request));
    const d = hook.result.current.draw!;
    const { ctx, paths } = recorder();
    draw(canvas(ctx), host, d);
    const geo = C[name].geometry;
    const { sx, sy } = mapper(plotRect(600, 400, d), geo.x_domain, geo.y_domain);
    for (const [a, b] of geo.caps) expect(findPath(paths, [[sx(a[0]), sy(a[1])], [sx(b[0]), sy(b[1])]]), "cap").toBeDefined();
  });

  it("without the option the request carries no caps and the canvas draws none", async () => {
    const hook = await lollipopStage("lollipopCaps", false);
    const req = (await exported(hook)) as any;
    expect(req.dist3).not.toHaveProperty("caps");
    const { ctx, paths } = recorder();
    const d = hook.result.current.draw!;
    draw(canvas(ctx), host, d);
    const geo = C.lollipopCaps.geometry;
    const { sx, sy } = mapper(plotRect(600, 400, d), geo.x_domain, geo.y_domain);
    const [a, b] = geo.caps[0];
    expect(findPath(paths, [[sx(a[0]), sy(a[1])], [sx(b[0]), sy(b[1])]])).toBeUndefined();
  });

  it("the caps checkbox in the toolbar turns them on, and is disabled without whiskers or with a median", () => {
    useApp.setState({ statPicks: { mode: "lollipop" } });
    function Toolbar() {
      return createElement(StatDist3Controls, { st: useWiredStage() });
    }
    render(createElement(Toolbar));
    const box = () => screen.getByLabelText("caps") as HTMLInputElement;
    expect(box().disabled).toBe(true); // no whiskers yet
    fireEvent.change(screen.getByLabelText("whiskers"), { target: { value: "sem" } });
    expect(box().disabled).toBe(false);
    fireEvent.click(box());
    expect(useApp.getState().statPicks).toMatchObject({ lollipopWhisker: "sem", lollipopCaps: true });
    expect(box().checked).toBe(true);
    act(() => useApp.setState({ statPicks: { mode: "lollipop", lollipopStat: "median", lollipopWhisker: "sem", lollipopCaps: true } }));
    expect(box().disabled).toBe(true);
    expect(box().checked).toBe(false);
  });
});

async function ridgeStage(shared: boolean, each = false) {
  const hook = renderHook(() => useWiredStage());
  act(() => {
    const s = hook.result.current;
    s.setMode("ridgeline"); s.setValueCol(col("value")); s.setGroupCol(col("grp"));
    s.setDist2({ ridgeShared: shared, ridgeEach: each });
    s.setFacetCol(col("site"));
  });
  await waitFor(() => expect(hook.result.current.drawFacets?.length).toBe(2));
  await waitFor(() => expect(hook.result.current.busy).toBe(false));
  return hook;
}

describe("ridgeline grid on one density scale", () => {
  it("the TS geometry equals the Python geometry on the shared maximum", () => {
    const c = C.ridgeShared;
    (c.panels as { response: any; geometry: any }[]).forEach((p) => {
      const g = ridgelineGeometry(p.response, 1, false, c.shared_max);
      g.ridges.forEach((r, k) => r.line.forEach(([x, y], i) => {
        expect(x).toBeCloseTo(p.geometry.ridges[k].line[i][0], 10);
        expect(y).toBeCloseTo(p.geometry.ridges[k].line[i][1], 10);
      }));
    });
    // `each` wins over a shared maximum (the control forbids the pair; the geometry never mixes them)
    const own = ridgelineGeometry(c.panels[0].response, 1, true, c.shared_max);
    expect(own.ridges[0].line.map((p) => p[1])).toEqual(ridgelineGeometry(c.panels[0].response, 1, true).ridges[0].line.map((p) => p[1]));
  });

  it("the stage exports the fixture request (each panel carries the shared maximum) and draws the shared scale", async () => {
    const hook = await ridgeStage(true);
    expect(stripPalette(await exported(hook))).toEqual(stripPalette(C.ridgeShared.request));
    hook.result.current.drawFacets!.forEach((f, i) => {
      const d = f.draw as any;
      expect(d.sharedMax).toBeCloseTo(C.ridgeShared.shared_max, 12);
      const { ctx, paths } = recorder();
      draw(canvas(ctx), host, f.draw);
      const geo = C.ridgeShared.panels[i].geometry;
      const { sx, sy } = mapper(plotRect(600, 400, f.draw), geo.domain, geo.y_domain);
      const line = (geo.ridges[0].line as [number, number][]).map(([x, y]): [number, number] => [sx(x), sy(y)]);
      expect(findPath(paths, line), `panel ${i} first ridge`).toBeDefined();
    });
  });

  it("off, the panels keep their own scale and the request has no maximum", async () => {
    const hook = await ridgeStage(false);
    const req = (await exported(hook)) as any;
    (req.facets as Facet[]).forEach((f) => expect(f.dist3).not.toHaveProperty("d_max"));
    hook.result.current.drawFacets!.forEach((f) => expect((f.draw as any).sharedMax).toBeUndefined());
  });

  it("with 'each to its peak' the shared maximum is not sent", async () => {
    const hook = await ridgeStage(true, true);
    const req = (await exported(hook)) as any;
    (req.facets as Facet[]).forEach((f) => expect(f.dist3).not.toHaveProperty("d_max"));
  });

  it("the shared-scale checkbox needs a facet column and not 'each', and writes the pick", () => {
    useApp.setState({ statPicks: { mode: "ridgeline" } });
    const seen: { stage?: ReturnType<typeof useStatStage> } = {};
    function Toolbar({ onStage }: { onStage: (s: ReturnType<typeof useStatStage>) => void }) {
      const st = useWiredStage();
      useEffect(() => onStage(st));
      return createElement(StatDist2Controls, { st });
    }
    render(createElement(Toolbar, { onStage: (s) => { seen.stage = s; } }));
    const box = () => screen.getByLabelText("shared scale") as HTMLInputElement;
    expect(box().disabled).toBe(true); // no facet column
    expect(box().closest("label")!.title).toMatch(/needs a facet column/i);
    act(() => seen.stage!.setFacetCol(col("site")));
    expect(box().disabled).toBe(false);
    fireEvent.click(box());
    expect(useApp.getState().statPicks).toMatchObject({ ridgeShared: true });
    fireEvent.click(screen.getByLabelText("each to its peak"));
    expect(box().disabled).toBe(true);
    expect(box().checked).toBe(false);
    expect(box().closest("label")!.title).toMatch(/each to its peak/);
  });
});

describe("the picks survive a save and reopen, and bad ones are dropped", () => {
  const roundTrip = () => {
    const st = useApp.getState();
    useApp.getState().loadWorkspace(parseWorkspace(serializeWorkspace({ ...st, plotWindows: st.windowsForSave() })));
    return useApp.getState().statPicks;
  };
  it("round-trips both", () => {
    useApp.setState({ statPicks: { mode: "lollipop", lollipopWhisker: "ci", lollipopCaps: true, ridgeShared: true } });
    expect(roundTrip()).toMatchObject({ lollipopCaps: true, ridgeShared: true });
  });
  it("drops a non-boolean (fail closed)", () => {
    useApp.setState({ statPicks: { mode: "lollipop", lollipopCaps: "yes" as unknown as boolean, ridgeShared: 1 as unknown as boolean } });
    expect(roundTrip()).toEqual({ mode: "lollipop" });
  });
});
