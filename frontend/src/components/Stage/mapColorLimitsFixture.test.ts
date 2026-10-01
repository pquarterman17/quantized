// A 2-D map's explicit COLOUR LIMITS, screen == export, pinned as a SHARED
// wire fixture (`tests/fixtures/wire/map_color_limits.json`).
//
// The canvas paints the heatmap and its colourbar over the pair
// `effectiveColorLimits` resolves (`mapRender.draw`; real-raster proof in
// `mapRenderLimits.test.ts`). The vector export used to send only a CLAMP of
// z, so matplotlib normalised over the clamped data's own extent: limits wider
// than the data (the usual "same scale as the other map" case) exported the
// full colormap and a data-range colourbar. Each case states the colour range
// the canvas paints, in the request's z units (log10 under a log colour
// scale), beside the exact request the export sends; the backend half
// (`tests/test_export_map_color_limits.py`) asserts the rendered norm spans it.
//
// Regenerate only after a DELIBERATE rule change:
//   MAP_LIMITS_FIXTURE_WRITE=1 npx vitest run src/components/Stage/mapColorLimitsFixture.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { MapPayload } from "../../lib/mapdataFetch";
import { mapFigureBody, type MapExportView } from "./mapFigureExport";
import { effectiveColorLimits, minPositive } from "./mapRender";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "..", "tests", "fixtures", "wire", "map_color_limits.json",
);

/** 3x2 grid, z from `lo` to `hi` in even steps. */
function grid(lo: number, hi: number): MapPayload {
  const step = (hi - lo) / 5;
  return {
    xAxis: [0, 1, 2],
    yAxis: [10, 20],
    zGrid: [
      [lo, lo + step, lo + 2 * step],
      [lo + 3 * step, lo + 4 * step, hi],
    ],
    xLabel: "2Theta",
    xUnit: "deg",
    yLabel: "Omega",
    yUnit: "deg",
    zLabel: "I",
    zUnit: "cts",
    zMin: lo,
    zMax: hi,
  };
}

interface Case {
  name: string;
  payload: MapPayload;
  view: MapExportView;
  /** The colour range the canvas paints, in the request's z units. */
  clim: [number, number];
}

const OFF = { on: false, levelCount: 8, scale: "linear" as const };
const LIN = { cmap: "viridis" as const, logZ: false, contour: OFF };
const LOG = { cmap: "viridis" as const, logZ: true, contour: OFF };

const CASES: Case[] = [
  { name: "auto: the data's own extent", payload: grid(20, 80), view: { ...LIN, colorLimits: null }, clim: [20, 80] },
  { name: "limits wider than the data", payload: grid(20, 80), view: { ...LIN, colorLimits: [0, 100] }, clim: [0, 100] },
  { name: "limits inside the data", payload: grid(20, 80), view: { ...LIN, colorLimits: [30, 60] }, clim: [30, 60] },
  { name: "limits past one end only", payload: grid(20, 80), view: { ...LIN, colorLimits: [0, 50] }, clim: [0, 50] },
  { name: "log colour scale, wider limits", payload: grid(10, 1000), view: { ...LOG, colorLimits: [1, 10000] }, clim: [0, 4] },
  // A non-positive explicit lo is raised to the smallest positive cell.
  { name: "log colour scale, non-positive lo", payload: grid(10, 1000), view: { ...LOG, colorLimits: [-1, 10000] }, clim: [1, 4] },
  {
    name: "contour overlay, wider limits",
    payload: grid(20, 80),
    view: { ...LIN, colorLimits: [0, 100], contour: { on: true, levelCount: 6, scale: "linear" } },
    clim: [0, 100],
  },
];

const OPTS = { fmt: "svg", style: "default", title: "", filename: "scan_map" };

/** The pair the canvas paints with — `mapRender.draw`'s own call. */
function painted(c: Case): [number, number] | null {
  const p = c.payload;
  return effectiveColorLimits(
    c.view.colorLimits ? [c.view.colorLimits[0], c.view.colorLimits[1]] : null,
    c.view.logZ ? minPositive(p.zGrid) : p.zMin,
    p.zMax,
    c.view.logZ,
  );
}

function fresh() {
  return { cases: CASES.map((c) => ({ name: c.name, request: mapFigureBody(c.payload, c.view, OPTS), clim: c.clim })) };
}

describe("map colour limits, screen == export", () => {
  it.each(CASES)("canvas: $name", (c) => {
    const pair = painted(c);
    expect(pair).not.toBeNull();
    const want = c.view.logZ ? (pair as [number, number]).map(Math.log10) : pair;
    expect(want?.[0]).toBeCloseTo(c.clim[0], 12);
    expect(want?.[1]).toBeCloseTo(c.clim[1], 12);
  });

  it.each(CASES)("request: $name", (c) => {
    const body = mapFigureBody(c.payload, c.view, OPTS);
    if (c.view.colorLimits === null) {
      expect(body.z_limits).toBeUndefined();
      return;
    }
    expect(body.z_limits?.[0]).toBeCloseTo(c.clim[0], 12);
    expect(body.z_limits?.[1]).toBeCloseTo(c.clim[1], 12);
  });

  it("matches the committed fixture the backend half reads", () => {
    const now = fresh();
    if (process.env.MAP_LIMITS_FIXTURE_WRITE) {
      writeFileSync(FIXTURE, `${JSON.stringify(now, null, 2)}\n`, "utf8");
    }
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(JSON.parse(JSON.stringify(now)));
  });
});
