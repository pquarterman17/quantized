// The polar view's export, screen == export, pinned as a SHARED wire fixture
// (`tests/fixtures/wire/polar_figure.json`).
//
// "Export figure…" / "Copy figure" from the polar view used to post an XY
// request and get a Cartesian figure back. This half builds, per case, the
// exact request the Stage commands send (`buildStageFigureSpec` with
// `polarMode` on) beside where the CANVAS puts every point — computed with the
// canvas' own functions (`polarToXY`, `radiusNorm`, `polarRadialRange`) on a
// unit disk, x right, y DOWN. The backend half (`tests/test_export_polar.py`)
// renders the request and asserts every drawn point lands in the same place.
//
// Regenerate only after a DELIBERATE rule change:
//   POLAR_FIXTURE_WRITE=1 npx vitest run src/lib/polarFigureFixture.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

import { buildStageFigureSpec } from "./figureSpecStage";
import { POLAR_CANVAS, POLAR_LINE_PX, polarChannels, polarRadialRange, polarToXY, radiusNorm } from "./polar";
import type { Dataset, SeriesStyle } from "./types";
import { useApp } from "../store/useApp";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "tests", "fixtures", "wire", "polar_figure.json",
);

interface Case {
  name: string;
  data: Dataset["data"];
  yKeys: number[] | null;
  seriesStyles?: Record<number, SeriesStyle>;
  seriesLabels?: Record<number, string>;
  showGrid?: boolean;
}

/** Canvas coordinates can differ by one final IEEE-754 bit across JS engines. */
function stableCanvasPoints(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableCanvasPoints);
  return typeof value === "number" ? Number(value.toPrecision(14)) : value;
}

const ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];
const CASES: Case[] = [
  {
    name: "two channels share one radial range, min at the centre",
    data: {
      time: ANGLES,
      values: ANGLES.map((a, i) => [Math.cos((a * Math.PI) / 180), i % 3]),
      labels: ["Mx", "Count"],
      units: ["emu", ""],
      metadata: {},
    },
    yKeys: null,
    seriesStyles: { 1: { color: "#d62728" } },
    seriesLabels: { 0: "Loop A" },
  },
  {
    name: "a channel subset with the grid off",
    data: {
      time: [-90, 0, 30, 400],
      values: [[1, 5, 2], [1, 6, 3], [1, 7, 4], [1, 8, 9]],
      labels: ["A", "B", "C"],
      units: ["", "", ""],
      metadata: {},
    },
    yKeys: [2],
    showGrid: false,
  },
  {
    name: "a constant channel falls back to [0, 1] and clamps to the rim",
    data: { time: [0, 120, 240], values: [[5], [5], [5]], labels: ["K"], units: ["au"], metadata: {} },
    yKeys: null,
  },
];

function dataset(c: Case, extra: Partial<Dataset> = {}): Dataset {
  return { id: "polar-ds", name: "polar.dat", data: c.data, ...extra } as Dataset;
}

function request(c: Case, extra: Partial<Dataset> = {}) {
  const ds = dataset(c, extra);
  useApp.setState({
    datasets: [ds],
    activeId: "polar-ds",
    polarMode: true,
    xKey: null,
    yKeys: c.yKeys,
    seriesStyles: c.seriesStyles ?? {},
    seriesLabels: c.seriesLabels ?? {},
    showGrid: c.showGrid ?? true,
    pageSetup: null,
  });
  return buildStageFigureSpec(useApp.getState, ds, "polar", { fmt: "svg", style: "default", dpi: 100, title: "" });
}

/** Where the canvas draws each point, on a unit disk (x right, y down);
 *  null where the canvas skips the point. */
function canvasPoints(c: Case): ([number, number] | null)[][] {
  const channels = polarChannels(c.yKeys, c.data.labels.length);
  const [lo, hi] = polarRadialRange(c.data.values, channels);
  return channels.map((ch) =>
    c.data.time.map((theta, k) => {
      const v = c.data.values[k][ch];
      return Number.isFinite(theta) && Number.isFinite(v) ? polarToXY(theta, radiusNorm(v, lo, hi), 0, 0, 1) : null;
    }),
  );
}

function fresh() {
  return { cases: CASES.map((c) => ({ name: c.name, request: request(c), canvas_points: canvasPoints(c) })) };
}

describe("a polar view exports as a polar figure, screen == export", () => {
  beforeEach(() => useApp.setState({ polarMode: false }));

  it.each(CASES)("request: $name", (c) => {
    const spec = request(c);
    const channels = polarChannels(c.yKeys, c.data.labels.length);
    expect(spec.polar).toMatchObject({ ...POLAR_CANVAS, r_lim: polarRadialRange(c.data.values, channels) });
    expect(spec.polar?.grid).toBe(c.showGrid ?? true);
    expect(spec.y_keys).toEqual(channels);
    expect(spec.x_key).toBeUndefined(); // the angle is the time column, as on the canvas
    expect(spec.dataset).toEqual(c.data); // no row state: the analysis view is the original data by reference
  });

  it("omits excluded and filtered rows through the same analysis view the canvas reads", () => {
    const c = CASES[1];
    const spec = request(c, {
      excludedRows: [1],
      filter: [{ col: 1, kind: "range", max: 7 }],
    });
    expect(spec.dataset.time).toEqual([-90, 30]);
    expect(spec.dataset.values).toEqual([[1, 5, 2], [1, 7, 4]]);
    expect(spec.polar?.r_lim).toEqual(polarRadialRange([[1, 5, 2], [1, 7, 4]], [2]));
  });

  it("the convention constant is what polarToXY draws: 90° up, counter-clockwise from east", () => {
    expect(POLAR_CANVAS).toEqual({ theta_unit: "deg", theta_direction: "ccw", theta_zero: "E" });
    const [ex, ey] = polarToXY(0, 1, 0, 0, 1);
    const [nx, ny] = polarToXY(90, 1, 0, 0, 1);
    expect([ex, ey].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([1, 0]);
    expect([nx, ny].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([0, -1]);
  });

  it("carries colour, legend renames and the canvas' fixed width — the canvas draws plain solid lines", () => {
    const spec = request({ ...CASES[0], seriesStyles: { 1: { color: "#d62728", width: 4, line: "dashed", marker: true } } });
    expect(spec.series_styles?.[1]).toEqual({ color: "#d62728", width: POLAR_LINE_PX });
    expect(spec.series_styles?.[0]).toMatchObject({ legend: "Loop A", width: POLAR_LINE_PX });
  });

  it("matches the committed fixture the backend half reads", () => {
    const now = fresh();
    if (process.env.POLAR_FIXTURE_WRITE) {
      writeFileSync(FIXTURE, `${JSON.stringify(now, null, 2)}\n`, "utf8");
    }
    const committed = JSON.parse(readFileSync(FIXTURE, "utf8")) as typeof now;
    const current = JSON.parse(JSON.stringify(now)) as typeof now;
    // Keep the actual request wire exact. The backend checks canvas geometry
    // with a 1e-6 tolerance, so only normalize its separately stored reference
    // coordinates past 14 significant digits to avoid libm/engine noise.
    expect(committed.cases.map(({ name, request: body }) => ({ name, request: body }))).toEqual(
      current.cases.map(({ name, request: body }) => ({ name, request: body })),
    );
    expect(stableCanvasPoints(committed.cases.map((c) => c.canvas_points))).toEqual(
      stableCanvasPoints(current.cases.map((c) => c.canvas_points)),
    );
  });
});
