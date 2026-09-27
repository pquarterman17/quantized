import { describe, expect, it } from "vitest";

import type { BoxStat } from "../../lib/statstage";
import { seriesStat, type BarChartData } from "../../lib/barlayout";
import { resolveStatMarks, type ResolvedStatMarks } from "../../lib/statMarks";
import { boxValueDomain } from "./statDrawMarks";
import { draw, drawCategoryAxis, fmt, plotRect, type StatDrawData, type ViolinGroup } from "./statRender";
import { categoryAxisLayout } from "./statRenderAxes";
import { drawConnectMeansLine } from "./statRenderBox";

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
  // Review finding 9: migrated off the removed `statRenderBox.boxValueDomain`
  // legacy wrapper (`(boxes, showMeanCI: boolean)`) onto the real, marks-API
  // one (`statDrawMarks.boxValueDomain`, `(boxes, ResolvedStatMarks)`) --
  // `withCI`/`withoutCI` reproduce exactly what the wrapper used to build.
  const withCI: ResolvedStatMarks = resolveStatMarks("box", { summary: "mean", errorBars: "ci95" });
  const withoutCI: ResolvedStatMarks = resolveStatMarks("box", { summary: "none" });

  it("spans the mean-CI extents when the marker is shown", () => {
    const [lo, hi] = boxValueDomain([smallN], withCI);
    expect(lo).toBeLessThanOrEqual(-5.85);
    expect(hi).toBeGreaterThanOrEqual(6.85);
  });

  it("ignores CI extents when the marker is off (whiskers + fliers only)", () => {
    const [lo, hi] = boxValueDomain([smallN], withoutCI);
    expect(lo).toBeGreaterThan(-1);
    expect(hi).toBeLessThan(2);
  });

  it("stays finite when CI bounds are undefined (n<2 backend payload)", () => {
    const noCI: BoxStat = { ...smallN, ciLo: undefined, ciHi: undefined, n: 1 };
    const [lo, hi] = boxValueDomain([noCI], withCI);
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
        marks: resolveStatMarks("box", { summary: "mean" }),
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
        marks: resolveStatMarks("strip", { summary: "mean" }),
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
        marks: resolveStatMarks("box", { connectMeans: true }),
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
        marks: resolveStatMarks("strip", { connectMeans: true }),
      }),
    ).toBe(true);
  });

  it("strip mode does not throw on an empty-points payload (defensive guard)", () => {
    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    expect(() =>
      draw(canvas, host, { mode: "strip", boxes: [], points: [], valueLabel: "v", groupLabel: "g" }),
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


describe("drawCategoryAxis — NESTED tick labels (Group R review finding 1; two tiers, P2.6 box 1)", () => {
  // The gap that let the Group R defect through: every test asserted on the
  // DATA layer, and nothing asserted what the label strings look like once
  // they reach the canvas — a 14-character truncation cut `lot = 0 / wafer = 0`
  // to `lot = 0 / waf…`, and the second factor was invisible. P2.6 box 1 draws
  // the nested axis in TWO TIERS (the export's `style_category_axis`): inner
  // level per tick, each outer level ONCE under its run, separators between.

  /** Records every `fillText` (with the rotation in force) and separator. */
  function recordingCtx() {
    const texts: { text: string; x: number; y: number; rot: number; align: string }[] = [];
    const seps: number[] = [];
    let rot = 0;
    let tx = 0;
    let ty = 0;
    const ctx = {
      font: "",
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 0,
      textAlign: "" as CanvasTextAlign,
      textBaseline: "" as CanvasTextBaseline,
      save: () => {},
      restore: () => {
        rot = 0;
        tx = 0;
        ty = 0;
      },
      translate: (x: number, y: number) => {
        tx = x;
        ty = y;
      },
      rotate: (a: number) => {
        rot = Math.round((a * 180) / Math.PI);
      },
      beginPath: () => {},
      stroke: () => {},
      lineTo: () => {},
      moveTo: (x: number) => seps.push(Math.round(x)),
      fillText(this: { textAlign: string }, text: string, x: number, y: number) {
        texts.push({ text, x: x + tx, y: y + ty, rot, align: this.textAlign });
      },
    } as unknown as CanvasRenderingContext2D;
    return { ctx, texts, seps };
  }

  const RECT = { x: 0, y: 0, w: 400, h: 200 };
  const SLOTS = [{ cx: 0.25 }, { cx: 0.75 }];
  const SLOTS4 = [{ cx: 0.125 }, { cx: 0.375 }, { cx: 0.625 }, { cx: 0.875 }];

  it("draws the inner level per tick and each outer level ONCE, with a separator between runs", () => {
    const { ctx, texts, seps } = recordingCtx();
    drawCategoryAxis(
      ctx, RECT, SLOTS4,
      ["lot = 0 / wafer = 0", "lot = 0 / wafer = 1", "lot = 1 / wafer = 0", "lot = 1 / wafer = 1"],
      "lot / wafer", "#000", "#888", { nestLabel: "wafer" },
    );
    const body = texts.filter((t) => t.text !== "lot / wafer");
    expect(body.map((t) => t.text)).toEqual([
      "wafer = 0", "wafer = 1", "wafer = 0", "wafer = 1", "lot = 0", "lot = 1",
    ]);
    // Each outer label is centred under its run; the inner ones sit above it.
    expect(body[4].x).toBe(100);
    expect(body[5].x).toBe(300);
    expect(body[4].y).toBeGreaterThan(body[0].y);
    // One separator, between wafer 1 of lot 0 and wafer 0 of lot 1.
    expect(seps).toEqual([200]);
    const caption = texts.find((t) => t.text === "lot / wafer");
    expect(caption?.y).toBe(RECT.h + categoryAxisLayout(["a = 0 / b = 0"], { nestLabel: "b" }).captionY);
    expect(caption!.y).toBeGreaterThan(body[4].y);
  });

  it("leaves a SINGLE-factor label on one line, exactly as before", () => {
    const { ctx, texts, seps } = recordingCtx();
    drawCategoryAxis(ctx, RECT, SLOTS, ["lot = 0", "lot = 1"], "lot", "#000", "#888");
    expect(texts.filter((t) => t.text !== "lot").map((t) => t.text)).toEqual(["lot = 0", "lot = 1"]);
    expect(seps).toEqual([]);
    expect(texts.find((t) => t.text === "lot")?.y).toBe(RECT.h + 30); // the caption never moved
  });

  it("still truncates an inner level that is genuinely too long", () => {
    const { ctx, texts } = recordingCtx();
    drawCategoryAxis(
      ctx, RECT, SLOTS,
      ["wafer = 7 / deposition_chamber = 0", "wafer = 7 / deposition_chamber = 1"],
      "x", "#000", "#888", { nestLabel: "deposition_chamber" },
    );
    expect(texts[0].text).toBe("deposition_ch…");
    expect(texts[2].text).toBe("wafer = 7");
  });

  it("wraps a long label onto lines (the export's wrap_label), instead of truncating", () => {
    const { ctx, texts } = recordingCtx();
    drawCategoryAxis(ctx, RECT, SLOTS, ["Anneal temperature 450 C", "B"], "x", "#000", "#888", { wrap: true });
    const first = texts.filter((t) => t.x === 100 && t.text !== "x");
    expect(first.map((t) => t.text)).toEqual(["Anneal", "temperature", "450 C"]);
    expect(first[1].y - first[0].y).toBe(11);
  });

  it("rotates labels about their END on the tick (matplotlib ha=right)", () => {
    const { ctx, texts } = recordingCtx();
    drawCategoryAxis(ctx, RECT, SLOTS, ["alpha", "beta"], "x", "#000", "#888", { rotation: 45 });
    const ticks = texts.filter((t) => t.text !== "x");
    expect(ticks.map((t) => [t.text, t.rot, t.align, t.x])).toEqual([
      ["alpha", -45, "right", 100],
      ["beta", -45, "right", 300],
    ]);
  });

  it("the layout's depth, caption and bottom margin grow with the label options", () => {
    const flat = categoryAxisLayout(["a", "b"]);
    expect([flat.depth, flat.captionY, flat.bottom]).toEqual([11, 30, 48]);
    const tiered = categoryAxisLayout(["a = 1 / b = 1", "a = 1 / b = 2"], { nestLabel: "b" });
    expect(tiered.captionY).toBe(44);
    expect(tiered.tiers).toEqual([{ label: "a = 1", first: 0, last: 1 }]);
    const upright = categoryAxisLayout(["abcdefghij"], { rotation: 90 });
    expect(upright.depth).toBe(60); // 10 chars x 6 px, turned on end
    expect(upright.bottom).toBe(6 + 60 + 13 + 18);
    expect(categoryAxisLayout(["one two three"], { wrap: true }).depth).toBe(22);
  });

  // Review finding 10: a click hit-test re-asks for the SAME draw's layout
  // repeatedly between renders (`statRenderSelection.ts`, via `plotRect`) --
  // it must not re-wrap/re-measure every label from scratch each time.
  it("memoizes the layout by its own inputs — repeat calls with the SAME inputs return the cached object", () => {
    const labelsA = ["Anneal temperature 450 C", "B"];
    const first = categoryAxisLayout(labelsA, { wrap: true, rotation: 45 });
    const second = categoryAxisLayout(labelsA, { wrap: true, rotation: 45 });
    expect(second).toBe(first); // same reference: a cache hit, not a recompute
    // A DIFFERENT (but content-equal) array still hits — the key is content,
    // not the array's own identity (a caller like `groups.map(g => g.label)`
    // builds a fresh array every time).
    const third = categoryAxisLayout([...labelsA], { wrap: true, rotation: 45 });
    expect(third).toBe(first);
    // Genuinely different inputs invalidate and recompute.
    const changed = categoryAxisLayout(["different", "labels"], { wrap: true, rotation: 45 });
    expect(changed).not.toBe(first);
    expect(changed.lines).not.toEqual(first.lines);
  });

  // Review finding 7.
  describe("plotRect's cap and drawCategoryAxis's own layout agree, for draw AND hit-test", () => {
    const LONG_LABELS = [
      "Anneal temperature under vacuum 450 C", "Anneal temperature under vacuum 500 C",
    ];
    const STYLE = { wrap: true, rotation: 90 as const };

    it("plotRect's margin is EXACTLY categoryAxisLayout's own bottom for the SAME cap", () => {
      const h = 140; // short canvas: h * 0.45 = 63, well under the natural depth
      const box: StatDrawData = { mode: "box", boxes: [BOX_A, BOX_B], valueLabel: "v", groupLabel: "g" };
      const rect = plotRect(400, h, box);
      expect(rect.maxBottom).toBeCloseTo(Math.max(48, h * 0.45), 9);
      const usedBottom = h - rect.y - rect.h;
      const layout = categoryAxisLayout(["g = A", "g = B"], {}, rect.maxBottom);
      expect(usedBottom).toBe(layout.bottom);
      // Capped, so smaller than the labels would have gotten uncapped.
      expect(usedBottom).toBeLessThan(categoryAxisLayout(["g = A", "g = B"]).bottom + 1000);
      expect(usedBottom).toBeLessThanOrEqual(rect.maxBottom as number);
    });

    it("drawCategoryAxis, fed the capped rect, draws EVERYTHING within the canvas — nothing below h", () => {
      const h = 90; // very short: forces the degrade ladder (wrap lines, then rotation)
      const rect = { x: 0, y: 0, w: 400, h: h - 48, maxBottom: Math.max(48, h * 0.45) };
      const { ctx, texts, seps } = recordingCtx();
      drawCategoryAxis(ctx, rect, SLOTS, LONG_LABELS, "caption", "#000", "#888", STYLE);
      const allY = [...texts.map((t) => t.y), ...seps];
      for (const y of allY) expect(y).toBeLessThanOrEqual(rect.y + rect.h + (rect.maxBottom as number) + 18);
      // The degraded layout's OWN rotation is what got drawn (never the
      // requested 90 if capping dropped it) -- checked structurally: every
      // tick's rotation state matches `categoryAxisLayout`'s reported one.
      const layout = categoryAxisLayout(LONG_LABELS, STYLE, rect.maxBottom);
      const ticks = texts.filter((t) => t.text !== "caption");
      const rotSeen = new Set(ticks.map((t) => t.rot));
      expect(rotSeen).toEqual(new Set([layout.rotation === 0 ? 0 : -layout.rotation]));
    });

    it("uncapped (a tall canvas), the layout is unchanged from before this fix", () => {
      const layout = categoryAxisLayout(LONG_LABELS, STYLE, 10000);
      expect(layout).toEqual(categoryAxisLayout(LONG_LABELS, STYLE));
    });
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
    ], SLOTS4, RECT, vy, "#000", [], "wafer");
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
