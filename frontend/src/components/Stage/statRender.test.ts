import { describe, expect, it } from "vitest";

import type { BoxStat } from "../../lib/statstage";
import { seriesStat, type BarChartData } from "../../lib/barlayout";
import { draw, drawCategoryAxis, fmt, type StatDrawData, type ViolinGroup } from "./statRender";
import { boxValueDomain, drawConnectMeansLine } from "./statRenderBox";

describe("fmt", () => {
  it("trims to <=4 significant figures", () => {
    expect(fmt(61.00000001)).toBe("61");
    expect(fmt(1036.0)).toBe("1036");
  });
  it("uses exponential outside [1e-3, 1e5)", () => {
    expect(fmt(4.2e7)).toBe("4.20e+7");
    expect(fmt(0.00001)).toBe("1.00e-5");
  });
  it("renders non-finite as an em dash", () => {
    expect(fmt(NaN)).toBe("—");
  });
});

// ── Real-raster verification: run the full draw() pipeline against an actual
// canvas raster and read back pixels. Requires a canvas backend (node-canvas in
// jsdom / a browser); skips cleanly where none is available so CI stays green
// even without the optional native dep (mapRender.test.ts's pattern — this is
// the "jsdom can't render" gap the pure-lib split (lib/statstage.ts) covers).
const CANVAS_OK = ((): boolean => {
  try {
    return document.createElement("canvas").getContext("2d") != null;
  } catch {
    return false;
  }
})();

/** Opaque, non-black pixels in an RGBA buffer (i.e. actually painted something). */
function countPainted(img: Uint8ClampedArray): number {
  let n = 0;
  for (let k = 0; k < img.length; k += 4) {
    if (img[k + 3] > 0 && img[k] + img[k + 1] + img[k + 2] > 0) n++;
  }
  return n;
}

const BOX_A: BoxStat = {
  label: "A",
  q1: 3.5,
  median: 6,
  q3: 8.5,
  iqr: 5,
  whislo: 1,
  whishi: 10,
  mean: 6.2,
  sem: 0.9,
  ciLo: 4.3,
  ciHi: 8.1,
  n: 11,
  fliers: [50],
};
const BOX_B: BoxStat = { ...BOX_A, label: "B", q1: 2, median: 4, q3: 6, whislo: 0, whishi: 9, fliers: [] };

const VIOLIN_A: ViolinGroup = {
  label: "A",
  x: Array.from({ length: 32 }, (_, i) => i / 4),
  density: Array.from({ length: 32 }, (_, i) => Math.exp(-((i - 16) ** 2) / 40)),
  quartiles: [6, 8, 10],
  n: 40,
};

describe("boxValueDomain", () => {
  // Small-n CI extends far beyond the whiskers: values {0, 1} give mean 0.5
  // and a t(0.975,1)=12.7-wide CI of roughly [-5.85, 6.85].
  const smallN: BoxStat = {
    label: "A", q1: 0.25, median: 0.5, q3: 0.75, iqr: 0.5,
    whislo: 0, whishi: 1, mean: 0.5, sem: 0.5,
    ciLo: -5.85, ciHi: 6.85, n: 2, fliers: [],
  };

  it("spans the mean-CI extents when the marker is shown", () => {
    const [lo, hi] = boxValueDomain([smallN], true);
    expect(lo).toBeLessThanOrEqual(-5.85);
    expect(hi).toBeGreaterThanOrEqual(6.85);
  });

  it("ignores CI extents when the marker is off (whiskers + fliers only)", () => {
    const [lo, hi] = boxValueDomain([smallN], false);
    expect(lo).toBeGreaterThan(-1);
    expect(hi).toBeLessThan(2);
  });

  it("stays finite when CI bounds are undefined (n<2 backend payload)", () => {
    const noCI: BoxStat = { ...smallN, ciLo: undefined, ciHi: undefined, n: 1 };
    const [lo, hi] = boxValueDomain([noCI], true);
    expect(Number.isFinite(lo)).toBe(true);
    expect(Number.isFinite(hi)).toBe(true);
  });
});

(CANVAS_OK ? describe : describe.skip)("draw (real raster)", () => {
  // 600x400 host fallback (clientWidth is 0 in jsdom).
  const readAll = (canvas: HTMLCanvasElement): Uint8ClampedArray =>
    canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;

  function paints(data: StatDrawData): boolean {
    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    draw(canvas, host, data);
    return countPainted(readAll(canvas)) > 0;
  }

  it("box mode paints boxes/whiskers/fliers", () => {
    expect(paints({ mode: "box", boxes: [BOX_A, BOX_B], valueLabel: "value", groupLabel: "group" })).toBe(
      true,
    );
  });

  it("box mode with points+mean-CI overlays still paints (JMP_GAP J5 #1/#2)", () => {
    expect(
      paints({
        mode: "box",
        boxes: [BOX_A, BOX_B],
        valueLabel: "value",
        groupLabel: "group",
        points: [
          { label: "A", points: [{ value: 4, rowIndex: 0 }, { value: 7, rowIndex: 1 }] },
          { label: "B", points: [{ value: 3, rowIndex: 2 }] },
        ],
        showMeanCI: true,
      }),
    ).toBe(true);
  });

  it("box mode does not throw when points/mean-CI are absent (default off)", () => {
    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    expect(() =>
      draw(canvas, host, { mode: "box", boxes: [BOX_A], valueLabel: "v", groupLabel: "g" }),
    ).not.toThrow();
  });

  it("strip mode paints jittered points (JMP_GAP J5 #3)", () => {
    expect(
      paints({
        mode: "strip",
        boxes: [BOX_A, BOX_B],
        points: [
          { label: "A", points: [{ value: 4, rowIndex: 0 }, { value: 7, rowIndex: 1 }, { value: 6, rowIndex: 2 }] },
          { label: "B", points: [{ value: 3, rowIndex: 3 }, { value: 5, rowIndex: 4 }] },
        ],
        valueLabel: "value",
        groupLabel: "group",
        showMeanCI: false,
        connectMeans: false,
      }),
    ).toBe(true);
  });

  it("strip mode with mean-CI marker also paints", () => {
    expect(
      paints({
        mode: "strip",
        boxes: [BOX_A],
        points: [{ label: "A", points: [{ value: 4, rowIndex: 0 }, { value: 7, rowIndex: 1 }] }],
        valueLabel: "value",
        groupLabel: "group",
        showMeanCI: true,
        connectMeans: false,
      }),
    ).toBe(true);
  });

  it("box mode with connect-means line also paints (JMP_GAP J5 residual)", () => {
    expect(
      paints({
        mode: "box",
        boxes: [BOX_A, BOX_B],
        valueLabel: "value",
        groupLabel: "group",
        showMeanCI: false,
        connectMeans: true,
      }),
    ).toBe(true);
  });

  it("strip mode with connect-means line also paints (JMP_GAP J5 residual)", () => {
    expect(
      paints({
        mode: "strip",
        boxes: [BOX_A, BOX_B],
        points: [
          { label: "A", points: [{ value: 4, rowIndex: 0 }] },
          { label: "B", points: [{ value: 3, rowIndex: 1 }] },
        ],
        valueLabel: "value",
        groupLabel: "group",
        showMeanCI: false,
        connectMeans: true,
      }),
    ).toBe(true);
  });

  it("strip mode does not throw on an empty-points payload (defensive guard)", () => {
    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    expect(() =>
      draw(canvas, host, {
        mode: "strip", boxes: [], points: [], valueLabel: "v", groupLabel: "g", showMeanCI: false,
        connectMeans: false,
      }),
    ).not.toThrow();
  });

  it("violin mode paints a filled outline", () => {
    expect(
      paints({ mode: "violin", violins: [VIOLIN_A], valueLabel: "value", groupLabel: "group" }),
    ).toBe(true);
  });

  it("qq mode paints a scatter + reference line", () => {
    const theo = [-2, -1, 0, 1, 2];
    const obs = [-1.8, -0.9, 0.1, 1.2, 2.1];
    expect(
      paints({ mode: "qq", theo, obs, slope: 1, intercept: 0, dist: "norm", valueLabel: "value" }),
    ).toBe(true);
  });

  it("histogram mode paints bars, and a fit overlay when present", () => {
    const edges = [0, 1, 2, 3, 4];
    const counts = [2, 5, 3, 1];
    expect(
      paints({ mode: "histogram", edges, counts, density: false, valueLabel: "value" }),
    ).toBe(true);
    expect(
      paints({
        mode: "histogram",
        edges,
        counts,
        density: true,
        valueLabel: "value",
        fit: { dist: "norm", x: [0, 1, 2, 3, 4], pdf: [0.05, 0.2, 0.3, 0.15, 0.02] },
      }),
    ).toBe(true);
  });

  it("bar mode (grouped) paints clustered bars with error whiskers", () => {
    const data: BarChartData = {
      groups: [
        { label: "Low", series: [seriesStat([1, 2, 3]), seriesStat([4, 5, 6])] },
        { label: "High", series: [seriesStat([10, 12]), seriesStat([-3, -1])] },
      ],
      seriesLabels: ["A", "B"],
    };
    expect(
      paints({ mode: "bar", data, valueLabel: "value", groupLabel: "group", stacked: false }),
    ).toBe(true);
  });

  it("bar mode (stacked) paints cumulative segments", () => {
    const data: BarChartData = {
      groups: [{ label: "Low", series: [seriesStat([1, 2, 3]), seriesStat([4, 5, 6])] }],
      seriesLabels: ["A", "B"],
    };
    expect(
      paints({ mode: "bar", data, valueLabel: "value", groupLabel: "group", stacked: true }),
    ).toBe(true);
  });

  it("bar mode does not throw on an empty-groups payload (defensive guard)", () => {
    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    const empty: BarChartData = { groups: [], seriesLabels: [] };
    expect(() =>
      draw(canvas, host, { mode: "bar", data: empty, valueLabel: "v", groupLabel: "g", stacked: false }),
    ).not.toThrow();
  });

  it("renders nothing but leaves the canvas clear for a null payload", () => {
    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    draw(canvas, host, null);
    expect(canvas.width).toBeGreaterThan(0); // sized (600×dpr)
    expect(countPainted(readAll(canvas))).toBe(0);
  });

  it("does not throw on an empty-boxes payload (defensive guard)", () => {
    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    expect(() => draw(canvas, host, { mode: "box", boxes: [], valueLabel: "v", groupLabel: "g" })).not.toThrow();
  });
});


describe("drawCategoryAxis — NESTED tick labels (Group R, review finding 1)", () => {
  // The gap that let the defect through: every Group R test asserted on the
  // DATA layer (which cells, which order, which label strings), and nothing
  // asserted what those strings look like once they reach the canvas. They
  // reached it through a 14-character truncation that cut
  // `lot = 0 / wafer = 0` down to `lot = 0 / waf…` — so a two-lot/two-wafer
  // plot painted four boxes under two distinct ticks, and the second factor,
  // the whole point of the feature, was invisible.

  /** Records every `fillText(text, x, y)` the renderer issues. */
  function recordingCtx() {
    const texts: { text: string; x: number; y: number }[] = [];
    const ctx = {
      font: "",
      fillStyle: "",
      textAlign: "" as CanvasTextAlign,
      textBaseline: "" as CanvasTextBaseline,
      fillText: (text: string, x: number, y: number) => texts.push({ text, x, y }),
    } as unknown as CanvasRenderingContext2D;
    return { ctx, texts };
  }

  const RECT = { x: 0, y: 0, w: 400, h: 200 };
  const SLOTS = [{ cx: 0.25 }, { cx: 0.75 }];

  it("stacks each half on its own line, so BOTH factors survive", () => {
    const { ctx, texts } = recordingCtx();
    drawCategoryAxis(
      ctx, RECT, SLOTS,
      ["lot = 0 / wafer = 0", "lot = 0 / wafer = 1"],
      "lot / wafer", "#000", "#888",
    );
    const ticks = texts.filter((t) => t.text !== "lot / wafer");
    expect(ticks.map((t) => t.text)).toEqual([
      "lot = 0", "wafer = 0",
      "lot = 0", "wafer = 1",
    ]);
    // The distinguishing half is present and DISTINCT per slot — the exact
    // property the truncation destroyed.
    expect(new Set(ticks.map((t) => t.text)).size).toBe(3);
    // Second line sits below the first, and above the caption at +30.
    expect(ticks[1].y).toBeGreaterThan(ticks[0].y);
    expect(ticks[1].y).toBeLessThan(RECT.y + RECT.h + 30);
  });

  it("leaves a SINGLE-factor label on one line, exactly as before", () => {
    const { ctx, texts } = recordingCtx();
    drawCategoryAxis(ctx, RECT, SLOTS, ["lot = 0", "lot = 1"], "lot", "#000", "#888");
    expect(texts.filter((t) => t.text !== "lot").map((t) => t.text)).toEqual([
      "lot = 0", "lot = 1",
    ]);
  });

  it("still truncates a half that is genuinely too long, per line", () => {
    // The budget is not abolished — it now applies to each half, so a long
    // column name eats only its own line instead of erasing the other factor.
    const { ctx, texts } = recordingCtx();
    drawCategoryAxis(
      ctx, RECT, SLOTS,
      ["deposition_chamber = 0 / wafer = 7", "deposition_chamber = 1 / wafer = 8"],
      "x", "#000", "#888",
    );
    const ticks = texts.filter((t) => t.text !== "x");
    expect(ticks[0].text).toBe("deposition_ch…");
    expect(ticks[1].text).toBe("wafer = 7");
    expect(ticks[3].text).toBe("wafer = 8");
  });
});

describe("drawConnectMeansLine — segmented at the nested boundary (review finding 2)", () => {
  // The predicate is unit-tested in lib/statstage.test.ts; what is pinned here
  // is that the RENDERER honours it. A sabotage that made the renderer ignore
  // `breaks` was caught only by the compiler noticing an unused variable —
  // which would not have caught a subtler misuse (an off-by-one index, say).

  /** Records the path commands that decide where the line lifts. */
  function pathRecorder() {
    const ops: string[] = [];
    const ctx = {
      save: () => {}, restore: () => {}, beginPath: () => {}, stroke: () => {},
      setLineDash: () => {},
      strokeStyle: "", lineWidth: 0,
      moveTo: (x: number) => ops.push(`move@${Math.round(x)}`),
      lineTo: (x: number) => ops.push(`line@${Math.round(x)}`),
    } as unknown as CanvasRenderingContext2D;
    return { ctx, ops };
  }

  const mk = (label: string, mean: number): BoxStat => ({
    label, q1: 0, median: mean, q3: 2, iqr: 2, whislo: 0, whishi: 2,
    mean, n: 3, fliers: [],
  });
  const RECT = { x: 0, y: 0, w: 400, h: 200 };
  const SLOTS4 = [0.1, 0.3, 0.6, 0.9].map((cx) => ({ cx, halfWidth: 0.05 }));
  const vy = (v: number) => 100 - v;

  it("lifts the pen when the outer factor changes", () => {
    const { ctx, ops } = pathRecorder();
    drawConnectMeansLine(ctx, [
      mk("lot = 0 / wafer = 0", 1), mk("lot = 0 / wafer = 1", 2),
      mk("lot = 1 / wafer = 0", 3), mk("lot = 1 / wafer = 1", 4),
    ], SLOTS4, RECT, vy, "#000");
    // Two segments: a move starts each lot, and NO line is drawn across the
    // lot 0 -> lot 1 step (slot 2, x=240).
    expect(ops).toEqual(["move@40", "line@120", "move@240", "line@360"]);
  });

  it("draws ONE unbroken line for a single-factor plot", () => {
    const { ctx, ops } = pathRecorder();
    drawConnectMeansLine(ctx, [
      mk("lot = 0", 1), mk("lot = 1", 2), mk("lot = 2", 3), mk("lot = 3", 4),
    ], SLOTS4, RECT, vy, "#000");
    expect(ops).toEqual(["move@40", "line@120", "line@240", "line@360"]);
  });

  it("still lifts on a non-finite mean, as it always did", () => {
    const { ctx, ops } = pathRecorder();
    drawConnectMeansLine(ctx, [
      mk("a", 1), mk("b", Number.NaN), mk("c", 3), mk("d", 4),
    ], SLOTS4, RECT, vy, "#000");
    expect(ops).toEqual(["move@40", "move@240", "line@360"]);
  });
});
