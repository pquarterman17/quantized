// P1.4 residual 3 — Color-by on the CATEGORICAL marks, screen <-> export
// PARITY (the `plotEncodingExport.test.ts` / `statLevelsParity.test.ts`
// pattern). This is the FRONTEND half. From a Graph Builder spec it takes the
// Stat Stage seed a plot action sends (`plotEncodingStat.statSeed`), drives the
// real Stat Stage hook, paints its draw on a recording canvas and exports it,
// and asserts:
//   1. each glyph's body is filled with its colour LEVEL's palette colour
//      (the level order is the user's; an empty nested slot shifts nothing);
//   2. the export request carries the same levels, aligned with its groups,
//      and the palette as hex — palette[level] IS the colour the canvas drew;
//   3. the Graph Builder preview colours the same groups the same way;
//   4. request + screen are the committed wire fixture
//      `tests/fixtures/wire/graph_encoding_stat.json`, which the BACKEND half
//      (`tests/test_export_graph_encoding_stat.py`) posts to the real routes
//      and reads back, fill by fill.
//
// To regenerate after a DELIBERATE rule change:
//   GRAPH_ENCODING_FIXTURE_WRITE=1 npx vitest run src/components/Stage/statColorParity.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { statsBox, statsViolin } from "../../lib/api";
import { exportCategoricalFigure, exportStatplotFigure } from "../../lib/api/figures";
import { encodedSpecRender } from "../../lib/plotEncoding";
import { statSeed } from "../../lib/plotEncodingStat";
import type { PlotSpec } from "../../lib/plotspec";
import { SERIES_VARS } from "../../lib/seriesStyleCycle";
import type { DataStruct, Dataset } from "../../lib/types";
import type { StatStageSeed } from "../../store/useApp";
import { previewStatDraws } from "../workshops/graphbuilder/previewMarks";
import { draw as drawStat, type StatDrawData } from "./statRender";
import { useStatStage } from "./useStatStage";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  statsBox: vi.fn(),
  statsViolin: vi.fn(),
}));
vi.mock("../../lib/api/figures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/figures")>()),
  exportStatplotFigure: vi.fn(),
  exportCategoricalFigure: vi.fn(),
}));

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "../../../../tests/fixtures/wire/graph_encoding_stat.json");
const PALETTE = ["#0b6e4f", "#c3423f", "#2d3047", "#f2a541", "#5e548e", "#1b998b", "#e84855", "#3e2f5b"];

// ch0 lot L1/L2/L3 shown L3, L1, L2 (a level order); ch1 wafer W1/W2; ch2 y;
// ch3 fac F1/F2. No L2 row is on wafer W2, so the nested L2 / W2 slot is EMPTY.
const ROWS = [
  [0, 0, 1.0, 0], [0, 0, 1.5, 1], [0, 1, 2.0, 0], [0, 1, 2.4, 1], [0, 0, 1.2, 0],
  [1, 0, 3.0, 0], [1, 0, 3.3, 1], [1, 0, 3.1, 0], [1, 0, 3.6, 1],
  [2, 0, 5.0, 0], [2, 0, 5.5, 1], [2, 1, 6.0, 0], [2, 1, 6.1, 1], [2, 1, 6.4, 0],
];
const DATA: DataStruct = {
  time: ROWS.map((_, i) => i),
  values: ROWS,
  labels: ["lot", "wafer", "y", "fac"],
  units: ["", "", "", ""],
  metadata: {},
  cat_levels: { 0: ["L1", "L2", "L3"], 1: ["W1", "W2"], 3: ["F1", "F2"] },
  level_order: { 0: [2, 0, 1] },
};
const DS: Dataset = { id: "sc", name: "statcolor.csv", data: DATA };
const ref = (channel: number) => ({ datasetId: "sc", channel });
const spec = (mark: PlotSpec["mark"], color: number, facet = false): PlotSpec => ({
  version: 1,
  zones: {
    x: ref(0), y: [ref(2)], group: null, facet: facet ? ref(3) : null, yErr: [], xErr: null, color: ref(color),
  },
  mark,
});
const CASES = {
  box: spec("box", 1), // Color on wafer: lot nested by wafer, coloured by wafer
  violin: spec("violin", 0), // Color on X: each violin by its lot level
  bar: spec("bar", 0),
  facets: spec("box", 1, true),
} as const;
type Case = keyof typeof CASES;

const root = document.documentElement;
beforeEach(() => {
  PALETTE.forEach((c, i) => root.style.setProperty(SERIES_VARS[i], c));
  vi.mocked(statsBox).mockRejectedValue(new Error("offline")); // the client box stats: same algorithm
  vi.mocked(statsViolin).mockImplementation(async (data: number[]) => ({
    x: [Math.min(...data) - 1, Math.max(...data) + 1], density: [0.3, 0.3], bandwidth: 1, quartiles: [1, 2, 3], n: data.length,
  }));
  vi.mocked(exportStatplotFigure).mockResolvedValue(undefined);
  vi.mocked(exportCategoricalFigure).mockResolvedValue(undefined);
});
afterEach(() => SERIES_VARS.forEach((v) => root.style.removeProperty(v)));

/** Each glyph body's fill, in paint order: the translucent box / violin /
 *  bar fills (a point, marker or axis is drawn opaque). */
function bodyFills(d: StatDrawData): string[] {
  const fills: string[] = [];
  const noop = () => {};
  const ctx = {
    font: "", fillStyle: "", strokeStyle: "", lineWidth: 1, globalAlpha: 1, textAlign: "", textBaseline: "",
    save: noop, restore: noop, translate: noop, rotate: noop, setLineDash: noop, setTransform: noop, clearRect: noop,
    beginPath: noop, closePath: noop, stroke: noop, strokeRect: noop, fillText: noop, moveTo: noop, lineTo: noop, arc: noop,
    measureText: (t: string) => ({ width: t.length * 6 }),
    fill() {
      if (this.globalAlpha < 1) fills.push(this.fillStyle);
    },
    fillRect() {
      if (this.globalAlpha < 1) fills.push(this.fillStyle);
    },
  };
  const canvas = { getContext: () => ctx, width: 0, height: 0 } as unknown as HTMLCanvasElement;
  drawStat(canvas, { clientWidth: 480, clientHeight: 300 } as HTMLElement, d);
  return fills;
}

const onConsumed = () => {};
const SEEDS = Object.fromEntries(Object.entries(CASES).map(([k, s]) => [k, statSeed(s, DS)])) as Record<Case, StatStageSeed>;
const Y_KEYS = [2];

async function stage(which: Case) {
  const seed = SEEDS[which];
  const { result } = renderHook(() =>
    useStatStage({ active: DS, yKeys: Y_KEYS, xKey: null, seriesOrder: null, seed, onSeedConsumed: onConsumed }),
  );
  await waitFor(() => {
    const draws = result.current.drawFacets?.map((f) => f.draw) ?? [result.current.draw];
    expect(draws.length > 0 && draws.every((d) => d != null && "colorLevels" in d && d.colorLevels != null)).toBe(true);
    if (which === "violin") expect(result.current.draw?.mode).toBe("violin");
  });
  await act(async () => {
    await result.current.exportFigure("svg");
  });
  const request =
    which === "bar"
      ? vi.mocked(exportCategoricalFigure).mock.calls.at(-1)![0]
      : vi.mocked(exportStatplotFigure).mock.calls.at(-1)![0];
  const draws = result.current.drawFacets?.map((f) => f.draw) ?? [result.current.draw!];
  return { request, draws, screen: { fills: draws.map(bodyFills) } };
}

const written: Record<string, unknown> = {};
afterAll(() => {
  if (process.env.GRAPH_ENCODING_FIXTURE_WRITE === "1") writeFileSync(FIXTURE, `${JSON.stringify(written, null, 2)}\n`);
});

describe("Color-by on box / violin / bar — the Stat Stage draws and exports the same colours", () => {
  it("Graph Builder seeds: Color on X colours by X; on another column it nests X by it", () => {
    expect(SEEDS.box).toEqual({ mode: "box", groupCol: 0, valueCol: 2, facetCol: null, group2Col: 1, colorCol: 1 });
    expect(SEEDS.violin).toMatchObject({ mode: "violin", groupCol: 0, group2Col: null, colorCol: 0 });
    expect(SEEDS.bar).toMatchObject({ mode: "bar", groupCol: 0, colorCol: 0 });
    expect(SEEDS.facets).toMatchObject({ groupCol: 0, group2Col: 1, colorCol: 1, facetCol: 3 });
  });

  it.each(Object.keys(CASES) as Case[])("%s: screen fills, export levels, preview and the wire fixture agree", async (which) => {
    const { request, draws, screen } = await stage(which);
    const [P0, P1, P2] = PALETTE;
    // (1) the canvas, by LEVEL in the user's order: lot L3 is level 0; the
    // nested box order is L3/W1, L3/W2, L1/W1, L1/W2, L2/W1 (L2/W2 is empty).
    const byWafer = [P0, P1, P0, P1, P0];
    const want: Record<Case, string[][]> = {
      box: [byWafer],
      violin: [[P0, P1, P2]],
      bar: [[P0, P1, P2]],
      facets: [byWafer, byWafer],
    };
    expect(screen.fills).toEqual(want[which]);
    // (2) the request: palette[level] of each FILLED group is what the canvas drew.
    const panels: { color_levels?: (number | null)[] | null; data?: unknown[]; groups?: string[] }[] =
      "facets" in request && request.facets ? request.facets : [request];
    const palette = request.palette!;
    expect(palette).toEqual(PALETTE);
    panels.forEach((p, pi) => {
      const levels = p.color_levels!;
      expect(levels).toHaveLength(p.data?.length ?? p.groups!.length);
      const filled = levels.filter((_, gi) => !p.data || (p.data[gi] as number[]).length > 0);
      expect(filled.map((lv) => palette[lv!])).toEqual(screen.fills[pi]);
    });
    if (which === "box") expect(panels[0].color_levels).toEqual([0, 1, 0, 1, 0, null]); // the empty L2/W2 slot
    // (3) the Graph Builder preview colours the same groups the same way.
    const s = CASES[which];
    const preview = previewStatDraws(encodedSpecRender(s, [DS]).render, s, [DS], {}, { hideEmpty: false, showN: true });
    const previewDraws = preview.facets?.map((f) => f.draw) ?? [preview.flat!];
    expect(previewDraws.map((d) => ("colorLevels" in d ? d.colorLevels : null))).toEqual(
      draws.map((d) => ("colorLevels" in d ? d.colorLevels : null)),
    );
    // (4) the committed fixture, byte for byte.
    const current = JSON.parse(JSON.stringify({ request, screen })) as unknown;
    written[which] = current;
    const fixture = JSON.parse(readFileSync(FIXTURE, "utf-8")) as Record<string, unknown>;
    expect(current).toEqual(fixture[which]);
  });

  it("without a Color pick nothing changes: no levels on the draw, none on the wire", async () => {
    const { result } = renderHook(() =>
      useStatStage({ active: DS, yKeys: Y_KEYS, xKey: null, seriesOrder: null, seed: null, onSeedConsumed: onConsumed }),
    );
    act(() => result.current.setValueCol(2));
    await waitFor(() => expect(result.current.draw?.mode === "box" && result.current.draw.slots != null).toBe(true));
    expect(result.current.draw && "colorLevels" in result.current.draw).toBe(false);
    await act(async () => {
      await result.current.exportFigure("svg");
    });
    const req = vi.mocked(exportStatplotFigure).mock.calls.at(-1)![0];
    expect(req.color_levels).toBeUndefined();
    expect(req.palette).toBeUndefined();
  });

  it("a colour pick that is neither the group nor the nest colours nothing", async () => {
    const seed: StatStageSeed = { mode: "box", groupCol: 0, valueCol: 2, colorCol: 3 };
    const { result } = renderHook(() =>
      useStatStage({ active: DS, yKeys: Y_KEYS, xKey: null, seriesOrder: null, seed, onSeedConsumed: onConsumed }),
    );
    await waitFor(() => expect(result.current.draw?.mode === "box" && result.current.draw.slots != null).toBe(true));
    expect(result.current.colorCol).toBeNull();
    expect(result.current.draw && "colorLevels" in result.current.draw).toBe(false);
  });
});
