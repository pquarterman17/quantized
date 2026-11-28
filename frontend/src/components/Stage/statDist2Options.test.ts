// Plan item 20, marginal and ridgeline options: a marginal's group split, colour column and size
// column; a ridgeline's per-ridge scale, free overlap and bandwidth, and facets. Screen <-> export
// parity, pinned to the shared wire fixture `tests/fixtures/wire/stat_dist2_options.json` (Python
// half: `tests/test_stat_dist2_options.py`, which checks the numbers against numpy / scipy and
// draws the same requests with matplotlib).
//
// The real hook is driven on the fixture's own table (a NaN colour row and an excluded row must
// drop out), the request it posts must be the fixture's, the export request must be the fixture's,
// and the canvas must draw the fixture vertices.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportStatplotFigure } from "../../lib/api/figures";
import { statsMarginal, statsRidgeline } from "../../lib/api/statsDist2";
import { marginalGeometry, type MarginalWire } from "../../lib/statMarginal";
import { ridgelineGeometry, type RidgelineWire } from "../../lib/statRidgeline";
import type { DataStruct, Dataset } from "../../lib/types";
import { parseWorkspace } from "../../lib/workspace";
import { serializeWorkspace } from "../../lib/workspaceSerialize";
import { seriesColor } from "../../lib/uplotOpts";
import { setStatPicks } from "../../store/statLevelOptions";
import { useActiveDataset, useApp } from "../../store/useApp";
import { draw } from "./statRender";
import { useStatStage } from "./useStatStage";

vi.mock("../../lib/api/statsDist2", () => ({ statsMarginal: vi.fn(), statsRidgeline: vi.fn() }));
vi.mock("../../lib/api/figures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/figures")>()),
  exportStatplotFigure: vi.fn(),
}));

/* eslint-disable @typescript-eslint/no-explicit-any */
const here = dirname(fileURLToPath(import.meta.url));
const FIX = JSON.parse(readFileSync(join(here, "../../../../tests/fixtures/wire/stat_dist2_options.json"), "utf-8")) as {
  table: { labels: string[]; rows: (number | null)[][]; cat_levels: Record<string, string[]>; excluded_rows: number[] };
  marginal: Record<string, { route: Record<string, any>; request: Record<string, any>; response: MarginalWire; geometry: any }>;
  ridgeline: { route: { groups: number[][]; bw: number }; request: Record<string, any>; response: RidgelineWire; geometry: any };
  ridgeFacets: { request: Record<string, any>; panels: { label: string; data: number[][]; route: { groups: number[][]; bw: number }; response: RidgelineWire; geometry: any }[] };
};
const TABLE = FIX.table;
const col = (name: string) => TABLE.labels.indexOf(name);
const data: DataStruct = {
  time: TABLE.rows.map((_, i) => i),
  values: TABLE.rows.map((r) => r.map((v) => v ?? Number.NaN)),
  labels: TABLE.labels,
  units: TABLE.labels.map(() => ""),
  metadata: {},
  cat_levels: Object.fromEntries(TABLE.labels.flatMap((l, i) => (TABLE.cat_levels[l] ? [[i, TABLE.cat_levels[l]]] : []))),
};
const dataset: Dataset = { id: "o", name: "options.csv", data, excludedRows: TABLE.excluded_rows };

const stripPalette = (r: unknown) => {
  const { palette: _p, ...rest } = r as Record<string, unknown>;
  return rest;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Deep equality with a float tolerance (a platform's libm may differ in the last bit). */
function close(a: any, b: any, path = "$"): void {
  if (Array.isArray(a)) {
    expect(Array.isArray(b), path).toBe(true);
    expect(a.length, path).toBe(b.length);
    a.forEach((v, i) => close(v, b[i], `${path}[${i}]`));
  } else if (a && typeof a === "object") {
    expect(Object.keys(a).sort(), path).toEqual(Object.keys(b).sort());
    for (const k of Object.keys(a)) close(a[k], b[k], `${path}.${k}`);
  } else if (typeof a === "number") expect(a, path).toBeCloseTo(b, 9);
  else expect(a, path).toEqual(b);
}

function useWiredStage() {
  return useStatStage({
    active: useActiveDataset(), yKeys: null, xKey: null, seriesOrder: null, seed: null,
    onSeedConsumed: () => {}, picks: useApp((s) => s.statPicks), onPicksChange: setStatPicks,
  });
}
type Hook = { result: { current: ReturnType<typeof useStatStage> }; unmount: () => void };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(exportStatplotFigure).mockResolvedValue(undefined);
  vi.mocked(statsMarginal).mockImplementation((async (x: number[], y: number[], kind: string, _b: string, enc: any = {}) => {
    for (const c of Object.values(FIX.marginal)) {
      if (same(c.route.x, x) && same(c.route.y, y) && c.route.kind === kind && same(c.route.group, enc.group) && same(c.route.color, enc.color) && same(c.route.size, enc.size)) return c.response;
    }
    throw new Error("no fixture response for this request");
  }) as never);
  vi.mocked(statsRidgeline).mockImplementation((async (values: number[][]) => {
    for (const c of [FIX.ridgeline, ...FIX.ridgeFacets.panels]) if (same(c.route.groups, values)) return c.response;
    throw new Error("no fixture response for these groups");
  }) as never);
  const init = useApp.getInitialState();
  useApp.setState({
    datasets: [dataset], activeId: "o", statMode: true, statPicks: {},
    plotWindows: init.plotWindows, focusedWindowId: init.focusedWindowId, history: [], future: [],
  });
});

const exported = async (hook: Hook) => {
  await act(async () => {
    await hook.result.current.exportFigure("svg");
  });
  return vi.mocked(exportStatplotFigure).mock.calls.at(-1)![0];
};

async function marginal(name: string): Promise<Hook> {
  const hook = renderHook(() => useWiredStage());
  const s = () => hook.result.current;
  const kind = FIX.marginal[name].route.kind;
  act(() => { s().setMode("marginal"); s().setValueCol(col("moment")); s().setHistCols([col("field")]); s().setBins("sturges"); });
  act(() => s().setDist2({ marginal: kind }));
  if (name.startsWith("group")) { act(() => s().setGroupCol(col("lot"))); act(() => s().setDist2({ marginalSplit: true })); }
  if (name === "groupSize" || name === "colorSize") act(() => s().setDist2({ marginalSize: col("mass") }));
  if (name === "colorSize") act(() => s().setDist2({ marginalColor: col("temp") }));
  await waitFor(() => expect(s().draw?.mode).toBe("marginal"));
  await waitFor(() => expect(vi.mocked(statsMarginal).mock.calls.at(-1)?.[4]).toBeDefined());
  return hook;
}

describe("marginal encodings: the stage and the fixture agree", () => {
  it.each(Object.keys(FIX.marginal))("%s: posts the fixture route body and exports the fixture request", async (name) => {
    const hook = await marginal(name);
    const [x, y, kind, bins, enc] = vi.mocked(statsMarginal).mock.calls.at(-1)!;
    expect({ x, y, kind, bins, ...enc }).toEqual(FIX.marginal[name].route); // the NaN-colour row and the excluded row are gone
    expect(stripPalette(await exported(hook))).toEqual(stripPalette(FIX.marginal[name].request));
  });

  it.each(Object.keys(FIX.marginal))("%s: the TS vertices equal the Python geometry", (name) => {
    close(marginalGeometry(FIX.marginal[name].response), FIX.marginal[name].geometry);
  });

  it("an encoding left off posts exactly the plain request (today's default)", async () => {
    vi.mocked(statsMarginal).mockResolvedValue(FIX.marginal.groupHistogram.response);
    const hook = renderHook(() => useWiredStage());
    act(() => { hook.result.current.setMode("marginal"); hook.result.current.setValueCol(col("moment")); hook.result.current.setHistCols([col("field")]); });
    await waitFor(() => expect(hook.result.current.draw?.mode).toBe("marginal"));
    expect(vi.mocked(statsMarginal).mock.calls.at(-1)!.slice(2)).toEqual(["histogram", "fd", {}]);
  });

  it("the histogram's split is not the marginal's: switching mode never splits what the user did not split there", async () => {
    vi.mocked(statsMarginal).mockResolvedValue(FIX.marginal.groupHistogram.response);
    const hook = renderHook(() => useWiredStage());
    const s = () => hook.result.current;
    act(() => { s().setValueCol(col("moment")); s().setHistCols([col("field")]); s().setGroupCol(col("lot")); });
    act(() => { s().setMode("histogram"); s().setDist2({ histSplit: true }); });
    act(() => s().setMode("marginal"));
    await waitFor(() => expect(s().draw?.mode).toBe("marginal"));
    expect(vi.mocked(statsMarginal).mock.calls.at(-1)![4]).toEqual({}); // not split
    expect(s().dist2).toMatchObject({ histSplit: true, marginalSplit: false });
    act(() => s().setDist2({ marginalSplit: true })); // only the pick made here splits it
    await waitFor(() => expect(vi.mocked(statsMarginal).mock.calls.at(-1)![4]).toHaveProperty("group"));
    act(() => s().setDist2({ histSplit: false })); // and the histogram's pick no longer matters
    expect(s().dist2.marginalSplit).toBe(true);
  });

  it("a group split together with a colour column is refused with the reason, and nothing is posted", async () => {
    vi.mocked(statsMarginal).mockResolvedValue(FIX.marginal.groupHistogram.response);
    const hook = renderHook(() => useWiredStage());
    const s = () => hook.result.current;
    act(() => { s().setMode("marginal"); s().setValueCol(col("moment")); s().setHistCols([col("field")]); s().setGroupCol(col("lot")); });
    await waitFor(() => expect(s().draw?.mode).toBe("marginal"));
    vi.mocked(statsMarginal).mockClear();
    act(() => s().setDist2({ marginalSplit: true, marginalColor: col("temp") }));
    await waitFor(() => expect(s().error).toMatch(/both colour the points/));
    expect(s().draw).toBeNull();
    expect(statsMarginal).not.toHaveBeenCalled();
  });
});

// -- canvas recorder: every arc with the fill it was painted in ------------------------------

function arcs() {
  const out: { x: number; y: number; r: number; fill: unknown }[] = [];
  let fill: unknown = "";
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(_t, k: string) {
      if (k === "arc") return (x: number, y: number, r: number) => out.push({ x, y, r, fill });
      if (k === "fillStyle") return fill;
      if (k === "measureText") return () => ({ width: 10 });
      return () => {};
    },
    set(_t, k: string, v) {
      if (k === "fillStyle") fill = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, out };
}
const canvas = (ctx: CanvasRenderingContext2D) => ({ getContext: () => ctx, width: 0, height: 0 }) as unknown as HTMLCanvasElement;
const host = { clientWidth: 600, clientHeight: 400 } as HTMLElement;

describe("marginal encodings: the canvas draws the fixture", () => {
  it("colour and size: each point in its own fill, at half its diameter", async () => {
    const hook = await marginal("colorSize");
    const { ctx, out } = arcs();
    draw(canvas(ctx), host, hook.result.current.draw);
    const g = FIX.marginal.colorSize.geometry;
    const pts = out.slice(0, g.points.length);
    expect(pts.map((a) => a.fill)).toEqual(g.fills);
    pts.forEach((a, i) => expect(a.r).toBeCloseTo(g.diameters[i] / 2, 9));
  });

  it("group split: each point in its group's series colour, and the key's dots match", async () => {
    const hook = await marginal("groupBox");
    const { ctx, out } = arcs();
    draw(canvas(ctx), host, hook.result.current.draw);
    const g = FIX.marginal.groupBox.geometry;
    const pts = out.slice(0, g.points.length);
    expect(pts.map((a) => a.fill)).toEqual((g.point_group as number[]).map((k) => seriesColor(k)));
    const key = out.slice(g.points.length).filter((a) => a.r === 3);
    expect(key.map((a) => a.fill)).toEqual((g.key.groups.ids as number[]).map((k) => seriesColor(k)));
  });
});

// -- ridgeline ---------------------------------------------------------------------------------

async function ridge(facet: boolean): Promise<Hook> {
  const hook = renderHook(() => useWiredStage());
  const s = () => hook.result.current;
  act(() => { s().setMode("ridgeline"); s().setValueCol(col("value")); s().setGroupCol(col("lot")); });
  act(() => s().setDist2({ ridgeOverlap: 1.37, ridgeBw: "0.3", ridgeEach: true }));
  if (facet) {
    act(() => s().setFacetCol(col("site")));
    await waitFor(() => expect(s().drawFacets?.length).toBe(2));
  } else await waitFor(() => expect(s().draw?.mode).toBe("ridgeline"));
  return hook;
}

describe("ridgeline options: the stage and the fixture agree", () => {
  it("free overlap, a numeric bandwidth and the per-ridge scale: request, export and vertices", async () => {
    const hook = await ridge(false);
    const [groups, bw] = vi.mocked(statsRidgeline).mock.calls.at(-1)!;
    expect([groups, bw]).toEqual([FIX.ridgeline.route.groups, 0.3]);
    expect(stripPalette(await exported(hook))).toEqual(stripPalette(FIX.ridgeline.request));
    const d = hook.result.current.draw as any;
    close(ridgelineGeometry(d.wire, d.overlap, d.each), FIX.ridgeline.geometry);
    expect([d.overlap, d.each]).toEqual([1.37, true]);
  });

  it("the shared scale stays the default: no `each` on the draw or the request", async () => {
    const hook = await ridge(false);
    act(() => hook.result.current.setDist2({ ridgeEach: false }));
    await waitFor(() => expect((hook.result.current.draw as any).each).toBeUndefined());
    const spec = (await exported(hook)) as any;
    expect(spec.ridgeline).toEqual({ overlap: 1.37, bw: 0.3 });
  });

  it("facets: one panel per level of the facet column, each from its own rows, exported as the fixture", async () => {
    const hook = await ridge(true);
    const facets = hook.result.current.drawFacets!;
    expect(facets.map((f) => f.label)).toEqual(["north", "south"]);
    facets.forEach((f, i) => {
      const d = f.draw as any;
      expect(d.mode).toBe("ridgeline");
      expect(d.groups).toEqual(FIX.ridgeFacets.panels[i].data);
      close(ridgelineGeometry(d.wire, d.overlap, d.each), FIX.ridgeFacets.panels[i].geometry);
    });
    expect(stripPalette(await exported(hook))).toEqual(stripPalette(FIX.ridgeFacets.request));
  });

  it("a facet level whose group has no density is named, never drawn from other rows", async () => {
    const hook = renderHook(() => useWiredStage());
    const s = () => hook.result.current;
    // every north row of group A shares one value: no KDE for it
    const flat = { ...data, values: data.values.map((r) => (r[col("site")] === 0 && r[col("lot")] === 0 ? r.map((v, c) => (c === col("value") ? 4 : v)) : r)) };
    useApp.setState({ datasets: [{ ...dataset, data: flat }] });
    act(() => { s().setMode("ridgeline"); s().setValueCol(col("value")); s().setGroupCol(col("lot")); });
    act(() => s().setFacetCol(col("site")));
    await waitFor(() => expect(s().note).toMatch(/north.*needs at least 2 distinct/));
    expect(s().drawFacets?.map((f) => f.label)).toEqual(["south"]);
  });
});

describe("marginal and ridgeline options: picks survive save and reopen", () => {
  it("every new pick comes back", async () => {
    const hook = await ridge(false);
    act(() => hook.result.current.setDist2({ ridgeBw: "0.45", marginalSize: col("mass"), marginalColor: col("temp") }));
    const s = useApp.getState();
    const text = serializeWorkspace({ ...s, plotWindows: s.windowsForSave() });
    hook.unmount();
    useApp.setState({ statPicks: {}, datasets: [] });
    useApp.getState().loadWorkspace(parseWorkspace(text));
    expect(useApp.getState().statPicks).toMatchObject({
      mode: "ridgeline", ridgeOverlap: 1.37, ridgeBw: "0.45", ridgeEach: true, marginalSize: col("mass"), marginalColor: col("temp"),
    });
  });

  it("malformed values are dropped on load", () => {
    useApp.setState({ statPicks: { mode: "ridgeline", ridgeOverlap: 0, ridgeBw: "nope", ridgeEach: "yes" as never, marginalSize: -1, marginalColor: 1.5 } });
    const s = useApp.getState();
    const text = serializeWorkspace({ ...s, plotWindows: s.windowsForSave() });
    useApp.getState().loadWorkspace(parseWorkspace(text));
    expect(useApp.getState().statPicks).toEqual({ mode: "ridgeline" });
  });
});
