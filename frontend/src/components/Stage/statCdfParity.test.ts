// Plan item 20: the CDF plot and rug, screen <-> export parity, pinned to the
// shared wire fixture `tests/fixtures/wire/stat_cdf_rug.json` (its Python half,
// `tests/test_stat_cdf_rug.py`, draws the same `request` with matplotlib).
//
// Here: the real hook is driven on the fixture columns (a NaN row and an
// excluded row must drop out), the export request it posts must be the
// fixture request, the canvas painter must draw the fixture geometry vertex
// for vertex, and the picks must survive a real save and reopen.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsCdf } from "../../lib/api";
import { exportStatplotFigure } from "../../lib/api/figures";
import type { CdfGeometry, CdfWire } from "../../lib/statCdf";
import type { DataStruct, Dataset } from "../../lib/types";
import { parseWorkspace } from "../../lib/workspace";
import { serializeWorkspace } from "../../lib/workspaceSerialize";
import { setStatPicks } from "../../store/statLevelOptions";
import { useActiveDataset, useApp } from "../../store/useApp";
import { draw } from "./statRender";
import { useStatStage } from "./useStatStage";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  statsCdf: vi.fn(),
}));
vi.mock("../../lib/api/figures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/figures")>()),
  exportStatplotFigure: vi.fn(),
}));

const here = dirname(fileURLToPath(import.meta.url));
const FX = JSON.parse(readFileSync(join(here, "../../../../tests/fixtures/wire/stat_cdf_rug.json"), "utf-8")) as {
  request: Record<string, unknown> & { data: number[][] };
  response: CdfWire;
  geometry: CdfGeometry;
};

// Rows 6 (A is NaN) and 7 (huge, EXCLUDED) must not reach the plot.
const A = [1.5, 2, 2, 3, 4.5, 6, Number.NaN, 99];
const B = [0.5, 2.5, 3, 3, 3.5, 7, 8, 50];
const DATA: DataStruct = {
  time: A.map((_, i) => i),
  values: A.map((a, i) => [a, B[i]]),
  labels: ["A", "B"],
  units: ["", ""],
  metadata: {},
};
const DS: Dataset = { id: "cdf", name: "cdf.csv", data: DATA, excludedRows: [7] };

function useWiredStage() {
  return useStatStage({
    active: useActiveDataset(), yKeys: null, xKey: null, seriesOrder: null, seed: null,
    onSeedConsumed: () => {}, picks: useApp((s) => s.statPicks), onPicksChange: setStatPicks,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(statsCdf).mockResolvedValue(FX.response);
  vi.mocked(exportStatplotFigure).mockResolvedValue(undefined);
  const init = useApp.getInitialState();
  useApp.setState({
    datasets: [{ ...DS }], activeId: "cdf", statMode: true, statPicks: {},
    plotWindows: init.plotWindows, focusedWindowId: init.focusedWindowId, history: [], future: [],
  });
});

async function configured() {
  const hook = renderHook(() => useWiredStage());
  act(() => hook.result.current.setMode("cdf"));
  act(() => hook.result.current.setValueCol(0));
  act(() => hook.result.current.setHistCols([1]));
  act(() => hook.result.current.setFit("norm"));
  act(() => hook.result.current.setCdfBand(true));
  act(() => hook.result.current.setRug({ on: true, length: 0.05, opacity: 0.4 }));
  await waitFor(() => expect(hook.result.current.draw?.mode).toBe("cdf"));
  return hook;
}

describe("CDF plot: the stage and the fixture agree", () => {
  it("says so when the numbers were computed in the browser (no server)", async () => {
    vi.mocked(statsCdf).mockResolvedValue({ ...FX.response, local: true });
    const { result } = await configured();
    await waitFor(() => expect(result.current.note).toMatch(/computed locally/));
  });

  it("asks the backend for the finite, non-excluded values of every picked column", async () => {
    await configured();
    const [columns, y, band, fit] = vi.mocked(statsCdf).mock.calls.at(-1)!;
    expect(columns).toEqual(FX.request.data); // NaN and the excluded row are gone
    expect([y, band, fit]).toEqual(["proportion", true, "norm"]);
  });

  it("exports exactly the fixture request", async () => {
    const { result } = await configured();
    await act(async () => {
      await result.current.exportFigure("svg");
    });
    const spec = vi.mocked(exportStatplotFigure).mock.calls.at(-1)![0];
    const { palette: _a, ...rest } = spec as unknown as Record<string, unknown>;
    const { palette: _b, ...want } = FX.request;
    expect(rest).toEqual(want);
  });

  it("the count scale reaches the backend and the export", async () => {
    const { result } = await configured();
    act(() => result.current.setCdfY("count"));
    await waitFor(() => expect(vi.mocked(statsCdf).mock.calls.at(-1)![1]).toBe("count"));
    await waitFor(() => expect(result.current.busy).toBe(false));
    await act(async () => {
      await result.current.exportFigure("svg");
    });
    expect(vi.mocked(exportStatplotFigure).mock.calls.at(-1)![0]).toMatchObject({
      cdf: { y: "count", band: true }, y_label: "cumulative count",
    });
  });

  it("rug off sends no rug and draws none", async () => {
    const { result } = await configured();
    act(() => result.current.setRug({ on: false }));
    await waitFor(() => expect(result.current.draw?.mode === "cdf" && (result.current.draw.rug ?? null)).toBeNull());
    await act(async () => {
      await result.current.exportFigure("svg");
    });
    expect(vi.mocked(exportStatplotFigure).mock.calls.at(-1)![0]).not.toHaveProperty("rug");
  });

  it("changing the rug never refetches", async () => {
    const { result } = await configured();
    const calls = vi.mocked(statsCdf).mock.calls.length;
    act(() => result.current.setRug({ opacity: 0.9 }));
    expect(result.current.draw?.mode === "cdf" && result.current.draw.rug?.opts.opacity).toBe(0.9);
    expect(vi.mocked(statsCdf).mock.calls.length).toBe(calls);
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

describe("CDF plot: the canvas draws the fixture vertices", () => {
  it("step, band, fit and one tick per value", async () => {
    const { result } = await configured();
    const { ctx, paths, alphas } = recorder();
    const canvas = { getContext: () => ctx, width: 0, height: 0 } as unknown as HTMLCanvasElement;
    draw(canvas, { clientWidth: 600, clientHeight: 400 } as HTMLElement, result.current.draw);
    // The plot rect of a 600 x 400 canvas: x 60..580, y 20..352 (margins 60 / 20 / 20 / 48).
    const [d0, d1] = FX.geometry.domain;
    const px = (x: number) => 60 + ((x - d0) / (d1 - d0)) * 520;
    const py = (y: number) => 352 - (y / FX.geometry.y_max) * 332;
    const matches = (p: Path, poly: number[][]) =>
      p.length === poly.length &&
      p.every((v, i) => Math.abs(v.x - px(poly[i][0])) < 1e-6 && Math.abs(v.y - py(poly[i][1])) < 1e-6);
    for (const g of FX.geometry.series) {
      expect(paths.some((p) => matches(p, g.step)), "step").toBe(true);
      expect(paths.some((p) => matches(p, g.band!)), "band").toBe(true);
    }
    expect(paths.filter((p) => p.length === 256)).toHaveLength(2); // one fit curve per column
    // Rug: a move + line pair per finite value, in the rug opacity.
    const rug = paths.filter((_, i) => alphas[i] === 0.4);
    expect(rug.map((p) => p.length / 2)).toEqual(FX.request.data.map((c) => c.length));
  });
});

describe("CDF plot: picks survive save and reopen", () => {
  it("mode, Y scale, band, fit, extra column and rug come back", async () => {
    const { result, unmount } = await configured();
    act(() => result.current.setCdfY("count"));
    const s = useApp.getState();
    const text = serializeWorkspace({ ...s, plotWindows: s.windowsForSave() });
    unmount();
    useApp.setState({ statPicks: {}, datasets: [] });
    useApp.getState().loadWorkspace(parseWorkspace(text));
    const reopened = renderHook(() => useWiredStage()).result.current;
    expect(reopened.mode).toBe("cdf");
    expect([reopened.cdfY, reopened.cdfBand, reopened.fit, reopened.histCols]).toEqual(["count", true, "norm", [1]]);
    expect(reopened.rug).toEqual({ on: true, length: 0.05, opacity: 0.4 });
  });

  it("an old project with no CDF fields opens as before", () => {
    const { result } = renderHook(() => useWiredStage());
    expect([result.current.mode, result.current.cdfY, result.current.cdfBand, result.current.rug]).toEqual([
      "box", "proportion", false, undefined,
    ]);
  });

  it("a CDF save always carries its Y scale", () => {
    const { result } = renderHook(() => useWiredStage());
    act(() => result.current.setMode("cdf"));
    expect(useApp.getState().statPicks).toMatchObject({ mode: "cdf", cdfY: "proportion" });
  });
});
