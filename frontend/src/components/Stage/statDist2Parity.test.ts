// Plan item 20: the marginal plot and the ridgeline, screen <-> export parity,
// pinned to the shared wire fixtures `tests/fixtures/wire/stat_marginal.json` and
// `stat_ridgeline.json` (their Python half, `tests/test_stat_dist2.py`, draws the
// same requests with matplotlib).
//
// The real hook is driven on the fixture columns (a NaN row and an excluded row
// must drop out), the export request it posts must be the fixture request, the
// canvas painters must draw the fixture geometry vertex for vertex, and the new
// picks must survive a real save and reopen.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportStatplotFigure } from "../../lib/api/figures";
import { statsMarginal, statsRidgeline } from "../../lib/api/statsDist2";
import { marginalGeometry, type MarginalGeometry, type MarginalWire } from "../../lib/statMarginal";
import { ridgelineGeometry, type RidgelineGeometry, type RidgelineWire } from "../../lib/statRidgeline";
import type { DataStruct, Dataset } from "../../lib/types";
import { parseWorkspace } from "../../lib/workspace";
import { serializeWorkspace } from "../../lib/workspaceSerialize";
import { setStatPicks } from "../../store/statLevelOptions";
import { useActiveDataset, useApp } from "../../store/useApp";
import { draw } from "./statRender";
import { POINT_ALPHA, POINT_RADIUS, STRIP_ALPHA, marginalRects } from "./statRenderMarginal";
import { useStatStage } from "./useStatStage";

vi.mock("../../lib/api/statsDist2", () => ({ statsMarginal: vi.fn(), statsRidgeline: vi.fn() }));
vi.mock("../../lib/api/figures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/figures")>()),
  exportStatplotFigure: vi.fn(),
}));

const here = dirname(fileURLToPath(import.meta.url));
const wire = (name: string) => JSON.parse(readFileSync(join(here, "../../../../tests/fixtures/wire", name), "utf-8"));
type MarginalCase = { request: Record<string, unknown> & { data: number[][] }; response: MarginalWire; geometry: MarginalGeometry };
const MARGINAL = wire("stat_marginal.json").cases as Record<"histogram" | "box" | "rug", MarginalCase>;
const RIDGE = wire("stat_ridgeline.json") as {
  request: Record<string, unknown> & { data: number[][] };
  response: RidgelineWire;
  geometry: RidgelineGeometry;
};

const nan = Number.NaN;
const stripPalette = (r: unknown) => {
  const { palette: _p, ...rest } = r as Record<string, unknown>;
  return rest;
};

// MARGINAL data: columns "field" (0) and "moment" (1); row 12 has NaN in field,
// row 13 is huge and EXCLUDED: neither may reach the plot.
const [FX, FY] = MARGINAL.histogram.request.data;
const MDATA: DataStruct = {
  time: [...FX.map((_, i) => i), 12, 13],
  values: [...FX.map((x, i) => [x, FY[i]]), [nan, 9], [999, 999]],
  labels: ["field", "moment"],
  units: ["", ""],
  metadata: {},
};
// RIDGE data: three channels of different lengths, NaN padded, plus an excluded row.
const [GA, GB, GC] = RIDGE.request.data;
const rows = Math.max(GA.length, GB.length, GC.length);
const RDATA: DataStruct = {
  time: [...Array.from({ length: rows }, (_, i) => i), rows],
  values: [...Array.from({ length: rows }, (_, i) => [GA[i] ?? nan, GB[i] ?? nan, GC[i] ?? nan]), [500, 500, 500]],
  labels: ["A", "B", "C"],
  units: ["", "", ""],
  metadata: {},
};
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

async function marginal(kind: "histogram" | "box" | "rug") {
  load("m", MDATA);
  vi.mocked(statsMarginal).mockResolvedValue(MARGINAL[kind].response);
  const hook = renderHook(() => useWiredStage());
  act(() => hook.result.current.setMode("marginal"));
  act(() => hook.result.current.setValueCol(1));
  act(() => hook.result.current.setHistCols([0]));
  act(() => hook.result.current.setBins("sturges"));
  act(() => hook.result.current.setDist2({ marginal: kind }));
  await waitFor(() => expect(hook.result.current.draw?.mode).toBe("marginal"));
  await waitFor(() => expect(vi.mocked(statsMarginal).mock.calls.at(-1)?.[2]).toBe(kind));
  return hook;
}

async function ridgeline() {
  load("r", RDATA);
  vi.mocked(statsRidgeline).mockResolvedValue(RIDGE.response);
  const hook = renderHook(() => useWiredStage());
  act(() => hook.result.current.setMode("ridgeline"));
  act(() => hook.result.current.setGroupCol(null));
  act(() => hook.result.current.setDist2({ ridgeOverlap: 1.5 }));
  await waitFor(() => expect(hook.result.current.draw?.mode).toBe("ridgeline"));
  return hook;
}

describe("marginal plot: the stage and the fixture agree", () => {
  it.each(["histogram", "box", "rug"] as const)("%s: asks for the complete finite pairs and exports the fixture request", async (kind) => {
    const { result } = await marginal(kind);
    const [x, y, k, bins] = vi.mocked(statsMarginal).mock.calls.at(-1)!;
    expect([x, y]).toEqual(MARGINAL[kind].request.data); // the NaN row and the excluded row are gone
    expect([k, bins]).toEqual([kind, "sturges"]);
    await act(async () => {
      await result.current.exportFigure("svg");
    });
    const spec = vi.mocked(exportStatplotFigure).mock.calls.at(-1)![0];
    expect(stripPalette(spec)).toEqual(stripPalette(MARGINAL[kind].request));
  });

  it("without an X pick it plots against the dataset's own X column", async () => {
    load("m", MDATA);
    vi.mocked(statsMarginal).mockResolvedValue(MARGINAL.rug.response);
    const { result } = renderHook(() => useWiredStage());
    act(() => result.current.setMode("marginal"));
    act(() => result.current.setValueCol(1));
    await waitFor(() => expect(result.current.draw?.mode).toBe("marginal"));
    const [x, y] = vi.mocked(statsMarginal).mock.calls.at(-1)!;
    // row 12 has no "field" but a finite moment, so it IS a point here; the excluded row 13 is not
    expect(x).toEqual(MDATA.time.slice(0, FX.length + 1));
    expect(y).toEqual([...FY, 9]);
    expect(result.current.draw).toMatchObject({ xLabel: "x", yLabel: "moment" });
  });

  it("fewer than two complete rows is refused with a message, not a blank plot", async () => {
    load("m", { ...MDATA, values: MDATA.values.map(() => [nan, nan]) });
    const { result } = renderHook(() => useWiredStage());
    act(() => result.current.setMode("marginal"));
    await waitFor(() => expect(result.current.error).toMatch(/2 rows/));
    expect(result.current.draw).toBeNull();
    expect(statsMarginal).not.toHaveBeenCalled();
  });
});

// The canvas painter, recorded: every path's vertices and each stroke's alpha.

type Path = { op: "M" | "L"; x: number; y: number }[];

function recorder() {
  const paths: Path[] = [];
  const alphas: number[] = [];
  let cur: Path = [];
  let alpha = 1;
  const noop = () => {};
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(_t, k: string) {
      if (k === "beginPath") return () => { cur = []; };
      if (k === "moveTo") return (x: number, y: number) => cur.push({ op: "M", x, y });
      if (k === "lineTo") return (x: number, y: number) => cur.push({ op: "L", x, y });
      if (k === "stroke" || k === "fill") return () => { paths.push(cur); alphas.push(alpha); };
      if (k === "globalAlpha") return alpha;
      return noop;
    },
    set(_t, k: string, v) {
      if (k === "globalAlpha") alpha = v as number;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, paths, alphas };
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const canvas = (ctx: CanvasRenderingContext2D) => ({ getContext: () => ctx, width: 0, height: 0 }) as unknown as HTMLCanvasElement;
const host = { clientWidth: 600, clientHeight: 400 } as HTMLElement;
// The plot rect of a 600 x 400 canvas: x 60..580, y 20..352 (margins 60 / 20 / 20 / 48).
const RECT = { x: 60, y: 20, w: 520, h: 332 };

describe("marginal plot: the canvas draws the fixture vertices", () => {
  it.each(["histogram", "box", "rug"] as const)("%s: points and both strips", async (kind) => {
    const { result } = await marginal(kind);
    const { ctx, paths, alphas } = recorder();
    draw(canvas(ctx), host, result.current.draw);
    const geo = MARGINAL[kind].geometry;
    expect(marginalGeometry(MARGINAL[kind].response)).toEqual(geo); // the TS builder agrees with Python's
    const { main, top, right } = marginalRects(RECT);
    const [x0, x1] = geo.domain.x;
    const [y0, y1] = geo.domain.y;
    // the scatter: one marker per complete pair, in the points' alpha
    const at = alphas.indexOf(POINT_ALPHA);
    const pts = paths[at];
    expect(pts.map((v) => [v.x - POINT_RADIUS, v.y])).toEqual(
      geo.points.map(([x, y]) => [
        expect.closeTo(main.x + ((x - x0) / (x1 - x0)) * main.w, 6),
        expect.closeTo(main.y + main.h - ((y - y0) / (y1 - y0)) * main.h, 6),
      ]),
    );
    // a strip vertex: `a` along the strip, `c` across it from the scatter's edge
    const top_ = (a: number, c: number): [number, number] => [top.x + ((a - x0) / (x1 - x0)) * top.w, top.y + top.h - c * top.h];
    const right_ = (a: number, c: number): [number, number] => [right.x + c * right.w, right.y + right.h - ((a - y0) / (y1 - y0)) * right.h];
    const strips = [[top_, geo.strips.x], [right_, geo.strips.y]] as const;
    const has = (poly: [number, number][]) =>
      paths.some((p) => p.length === poly.length && p.every((v, i) => near(v.x, poly[i][0]) && near(v.y, poly[i][1])));
    for (const [map, s] of strips) {
      if (s.kind === "histogram") {
        for (const [a0, a1, h] of s.bars) expect(has([map(a0, 0), map(a1, 0), map(a1, h), map(a0, h)]), "bar").toBe(true);
      } else if (s.kind === "box") {
        expect(has([map(s.box[0], 0.25), map(s.box[1], 0.25), map(s.box[1], 0.75), map(s.box[0], 0.75)]), "box").toBe(true);
        const lo = map(s.median, 0.25);
        const hi = map(s.median, 0.75);
        // one path holds the median and both whiskers: median first, then the whisker pair
        expect(paths.some((p) => p.length === 6 && near(p[0].x, lo[0]) && near(p[0].y, lo[1]) && near(p[1].x, hi[0]) && near(p[1].y, hi[1])), "median").toBe(true);
      } else {
        const ticks = paths.filter((p, i) => alphas[i] === STRIP_ALPHA && p.length === 2 * s.ticks.length);
        expect(ticks.length, "rug").toBeGreaterThan(0);
        expect(ticks.some((p) => s.ticks.every(([a, c0, c1], i) => near(p[2 * i].x, map(a, c0)[0]) && near(p[2 * i + 1].y, map(a, c1)[1]))), "rug ticks").toBe(true);
      }
    }
    if (kind === "box") expect(geo.strips.x).toMatchObject({ kind: "box", fliers: [12] });
  });
});

describe("ridgeline: the stage and the fixture agree", () => {
  it("asks for each channel's finite, non-excluded values and exports the fixture request", async () => {
    const { result } = await ridgeline();
    const [groups, bw] = vi.mocked(statsRidgeline).mock.calls.at(-1)!;
    expect(groups).toEqual(RIDGE.request.data);
    expect(bw).toBe("scott");
    await act(async () => {
      await result.current.exportFigure("svg");
    });
    const spec = vi.mocked(exportStatplotFigure).mock.calls.at(-1)![0];
    expect(stripPalette(spec)).toEqual(stripPalette(RIDGE.request));
  });

  it("the bandwidth pick reaches the backend as a rule or a number", async () => {
    const { result } = await ridgeline();
    act(() => result.current.setDist2({ ridgeBw: "0.3" }));
    await waitFor(() => expect(vi.mocked(statsRidgeline).mock.calls.at(-1)![1]).toBe(0.3));
    act(() => result.current.setDist2({ ridgeBw: "silverman" }));
    await waitFor(() => expect(vi.mocked(statsRidgeline).mock.calls.at(-1)![1]).toBe("silverman"));
  });

  it("the overlap changes the drawing, never the request", async () => {
    const { result } = await ridgeline();
    const calls = vi.mocked(statsRidgeline).mock.calls.length;
    act(() => result.current.setDist2({ ridgeOverlap: 3 }));
    await waitFor(() => expect(result.current.draw?.mode === "ridgeline" && result.current.draw.overlap).toBe(3));
    expect(vi.mocked(statsRidgeline).mock.calls.length).toBeGreaterThanOrEqual(calls); // the draw is recomputed, the body is the same
    expect(vi.mocked(statsRidgeline).mock.calls.at(-1)![0]).toEqual(RIDGE.request.data);
  });

  it("a group without a density is refused by name", async () => {
    load("r", { ...RDATA, values: RDATA.values.map((r) => [r[0], 4, r[2]]) });
    const { result } = renderHook(() => useWiredStage());
    act(() => result.current.setMode("ridgeline"));
    act(() => result.current.setGroupCol(null));
    await waitFor(() => expect(result.current.error).toMatch(/"B" needs at least 2 distinct/));
    expect(statsRidgeline).not.toHaveBeenCalled();
  });
});

describe("ridgeline: the canvas draws the fixture vertices", () => {
  it("every fill polygon and outline, top row first", async () => {
    const { result } = await ridgeline();
    const { ctx, paths } = recorder();
    draw(canvas(ctx), host, result.current.draw);
    const g = RIDGE.geometry;
    expect(ridgelineGeometry(RIDGE.response, 1.5)).toEqual(g); // the TS builder agrees with Python's
    const [x0, x1] = g.domain;
    const [y0, y1] = g.y_domain;
    const px = (x: number) => RECT.x + ((x - x0) / (x1 - x0)) * RECT.w;
    const py = (y: number) => RECT.y + RECT.h - ((y - y0) / (y1 - y0)) * RECT.h;
    const at = (poly: number[][]) => paths.findIndex((p) =>
      p.length === poly.length && p.every((v, i) => near(v.x, px(poly[i][0])) && near(v.y, py(poly[i][1]))));
    const order: number[] = [];
    g.ridges.forEach((r) => {
      const f = at(r.fill);
      const l = at(r.line);
      expect(f, "fill").toBeGreaterThanOrEqual(0);
      expect(l, "line").toBeGreaterThan(f);
      order.push(f);
    });
    expect(order).toEqual([...order].sort((a, b) => a - b)); // the lower ridge paints over the upper
  });
});

describe("marginal and ridgeline: picks survive save and reopen", () => {
  it("marginal: kind, Y and X columns, bin rule come back", async () => {
    const { result, unmount } = await marginal("box");
    const s = useApp.getState();
    const text = serializeWorkspace({ ...s, plotWindows: s.windowsForSave() });
    unmount();
    useApp.setState({ statPicks: {}, datasets: [] });
    useApp.getState().loadWorkspace(parseWorkspace(text));
    const reopened = renderHook(() => useWiredStage()).result.current;
    expect(reopened.mode).toBe("marginal");
    expect([reopened.dist2.marginal, reopened.histCols, reopened.bins]).toEqual(["box", [0], "sturges"]);
    expect(result.current.mode).toBe("marginal");
  });

  it("ridgeline: overlap and bandwidth come back", async () => {
    const { result, unmount } = await ridgeline();
    act(() => result.current.setDist2({ ridgeBw: "0.6" }));
    const s = useApp.getState();
    const text = serializeWorkspace({ ...s, plotWindows: s.windowsForSave() });
    unmount();
    useApp.setState({ statPicks: {}, datasets: [] });
    useApp.getState().loadWorkspace(parseWorkspace(text));
    const reopened = renderHook(() => useWiredStage()).result.current;
    expect([reopened.mode, reopened.dist2.ridgeOverlap, reopened.dist2.ridgeBw]).toEqual(["ridgeline", 1.5, "0.6"]);
  });

  it("each save always carries its own picks, so an older build refuses it", () => {
    load("m", MDATA);
    const { result } = renderHook(() => useWiredStage());
    act(() => result.current.setMode("marginal"));
    expect(useApp.getState().statPicks).toMatchObject({ mode: "marginal", marginal: "histogram" });
    act(() => result.current.setMode("ridgeline"));
    expect(useApp.getState().statPicks).toMatchObject({ mode: "ridgeline", ridgeOverlap: 1, ridgeBw: "scott" });
  });

  it("an old project with none of these fields opens as before", () => {
    load("m", MDATA);
    const { result } = renderHook(() => useWiredStage());
    expect([result.current.mode, result.current.dist2]).toEqual(["box", expect.objectContaining({ marginal: "histogram", ridgeOverlap: 1, ridgeBw: "scott" })]);
  });

  it("an out-of-list pick is dropped on load (fail closed)", () => {
    load("m", MDATA);
    useApp.setState({ statPicks: { mode: "ridgeline", ridgeOverlap: 2.5 as 2, ridgeBw: "0.99" as "scott", marginal: "pie" as "box" } });
    const s = useApp.getState();
    const text = serializeWorkspace({ ...s, plotWindows: s.windowsForSave() });
    useApp.getState().loadWorkspace(parseWorkspace(text));
    expect(useApp.getState().statPicks).toEqual({ mode: "ridgeline" });
  });
});
