// P2.6 box 2 on the Canvas stage: empty category slots keep their tick and
// carry an `n=0` marker, the `n=` captions follow `showN`, the connect-means
// line lifts across a missing level, and a bar with no data draws nothing.
// Recorded against a call-logging context (jsdom has no raster), asserting the
// TEXT and GEOMETRY the renderer emits.

import { describe, expect, it } from "vitest";

import type { AxisSlot } from "../../lib/groupAxis";
import { boxStatsClient } from "../../lib/statstage";
import type { StatDrawData } from "./statRender";
import { drawBar } from "./statRenderBar";
import { drawBoxesWithMarks, drawStrip } from "./statRenderBox";
import { slotPlan } from "./statRenderSlots";

interface Call {
  fn: string;
  args: unknown[];
}

/** A 2D context that records every method call; property writes just stick. */
function recorder() {
  const calls: Call[] = [];
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get(t, key: string) {
      if (key in t) return t[key];
      return (...args: unknown[]) => {
        calls.push({ fn: key, args });
      };
    },
    set(t, key: string, v) {
      t[key] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  const texts = () => calls.filter((c) => c.fn === "fillText").map((c) => c.args[0] as string);
  return { ctx, calls, texts };
}

const RECT = { x: 0, y: 0, w: 300, h: 200 };
const slot = (label: string, group: number | null, n = 0): AxisSlot => ({
  label, group, n, nonFinite: 0, excluded: 0, absent: group === null,
});
const AXIS = [slot("g = A", 0, 3), slot("g = B", null), slot("g = C", 1, 2)];

function boxDraw(over: Partial<Extract<StatDrawData, { mode: "box" }>> = {}): Extract<StatDrawData, { mode: "box" }> {
  return {
    mode: "box",
    boxes: [boxStatsClient([1, 2, 3], 1.5, "g = A"), boxStatsClient([4, 6], 1.5, "g = C")],
    valueLabel: "y",
    groupLabel: "g",
    slots: AXIS,
    ...over,
  };
}

describe("slotPlan", () => {
  it("maps each plotted group to its axis slot and lists the empty ones", () => {
    const plan = slotPlan(AXIS, ["g = A", "g = C"]);
    expect(plan.labels).toEqual(["g = A", "g = B", "g = C"]);
    expect(plan.groupSlot).toEqual([0, 2]);
    expect(plan.empty).toEqual([1]);
    expect(plan.gaps).toEqual([false, true]);
  });

  it("is the identity without an axis, or with one that does not place every group once", () => {
    expect(slotPlan(null, ["a", "b"]).groupSlot).toEqual([0, 1]);
    expect(slotPlan([slot("a", 0, 1), slot("b", 0, 1)], ["a", "b"]).labels).toEqual(["a", "b"]);
  });
});

describe("box / strip with an empty slot", () => {
  it("keeps the empty level's tick, marks it n=0, and captions every slot", () => {
    const { ctx, texts } = recorder();
    drawBoxesWithMarks(ctx, RECT, boxDraw(), "#000", "#888");
    const t = texts();
    expect(t.filter((s) => s.startsWith("g = "))).toEqual(["g = A", "g = B", "g = C"]);
    // Caption row n=3 / n=0 / n=2, plus the mid-panel n=0 marker.
    expect(t.filter((s) => s.startsWith("n="))).toEqual(["n=0", "n=3", "n=0", "n=2"]);
  });

  it("showN=false drops the captions but never the empty-slot marker", () => {
    const { ctx, texts } = recorder();
    drawBoxesWithMarks(ctx, RECT, boxDraw({ showN: false }), "#000", "#888");
    expect(texts().filter((s) => s.startsWith("n="))).toEqual(["n=0"]);
  });

  it("places the second box in the THIRD slot, not the second", () => {
    const { ctx, calls } = recorder();
    drawBoxesWithMarks(ctx, RECT, boxDraw(), "#000", "#888");
    // Each box's IQR rectangle is one fillRect; its centre is x + w/2.
    const centres = calls.filter((c) => c.fn === "fillRect").map((c) => (c.args[0] as number) + (c.args[2] as number) / 2);
    expect(centres.map((x) => Math.round(x))).toEqual([50, 250]); // slots at 1/6 and 5/6 of 300
  });

  it("connect-means lifts the pen across the empty slot", () => {
    const { ctx, calls } = recorder();
    drawBoxesWithMarks(ctx, RECT, boxDraw({ connectMeans: true }), "#000", "#888");
    const dashed = calls.findIndex((c) => c.fn === "setLineDash" && (c.args[0] as number[]).length > 0);
    const after = calls.slice(dashed).filter((c) => c.fn === "moveTo" || c.fn === "lineTo").map((c) => c.fn);
    expect(after).toEqual(["moveTo", "moveTo"]);
  });

  it("connect-means still lifts where empty levels were HIDDEN (gapBefore), not only where one is shown", () => {
    const { ctx, calls } = recorder();
    // The empty level B hidden: two visible slots, the second marked gapBefore.
    const hidden = [slot("g = A", 0, 3), { ...slot("g = C", 1, 2), gapBefore: true }];
    drawBoxesWithMarks(ctx, RECT, boxDraw({ connectMeans: true, slots: hidden }), "#000", "#888");
    const dashed = calls.findIndex((c) => c.fn === "setLineDash" && (c.args[0] as number[]).length > 0);
    const after = calls.slice(dashed).filter((c) => c.fn === "moveTo" || c.fn === "lineTo").map((c) => c.fn);
    expect(after).toEqual(["moveTo", "moveTo"]);
    // ... and draws ONE segment when nothing was hidden between them.
    const { ctx: ctx2, calls: calls2 } = recorder();
    drawBoxesWithMarks(ctx2, RECT, boxDraw({ connectMeans: true, slots: [hidden[0], slot("g = C", 1, 2)] }), "#000", "#888");
    const d2 = calls2.findIndex((c) => c.fn === "setLineDash" && (c.args[0] as number[]).length > 0);
    expect(calls2.slice(d2).filter((c) => c.fn === "moveTo" || c.fn === "lineTo").map((c) => c.fn)).toEqual([
      "moveTo", "lineTo",
    ]);
  });

  it("strip mode lays out on the same axis", () => {
    const { ctx, texts } = recorder();
    const d: StatDrawData = {
      mode: "strip",
      boxes: boxDraw().boxes,
      points: [
        { label: "g = A", points: [{ value: 1, rowIndex: 0 }] },
        { label: "g = C", points: [{ value: 4, rowIndex: 3 }] },
      ],
      valueLabel: "y", groupLabel: "g", showMeanCI: false, connectMeans: false, slots: AXIS,
    };
    drawStrip(ctx, RECT, d, "#000", "#888");
    expect(texts().filter((s) => s.startsWith("g = "))).toEqual(["g = A", "g = B", "g = C"]);
    expect(texts().filter((s) => s === "n=0")).toHaveLength(2);
  });
});

describe("bar with missing data", () => {
  const bar = (over: Partial<Extract<StatDrawData, { mode: "bar" }>> = {}): Extract<StatDrawData, { mode: "bar" }> => ({
    mode: "bar",
    data: {
      seriesLabels: ["y"],
      groups: [
        { label: "A", series: [{ mean: 2, sem: 0.5, n: 3 }] },
        { label: "B", series: [{ mean: Number.NaN, sem: Number.NaN, n: 0 }] },
      ],
    },
    valueLabel: "y", groupLabel: "g", stacked: false,
    ...over,
  });

  it("draws no bar for a NaN mean (never a zero-height stand-in) and marks the empty category", () => {
    const { ctx, calls, texts } = recorder();
    drawBar(ctx, RECT, bar(), "#000", "#888");
    expect(calls.filter((c) => c.fn === "fillRect")).toHaveLength(1);
    expect(texts().filter((s) => s.startsWith("n="))).toEqual(["n=0", "n=3", "n=0"]);
  });

  it("showN=false keeps only the empty-category marker", () => {
    const { ctx, texts } = recorder();
    drawBar(ctx, RECT, bar({ showN: false }), "#000", "#888");
    expect(texts().filter((s) => s.startsWith("n="))).toEqual(["n=0"]);
  });

  it("stacked: a NaN segment draws nothing either", () => {
    const { ctx, calls } = recorder();
    drawBar(ctx, RECT, bar({ stacked: true }), "#000", "#888");
    expect(calls.filter((c) => c.fn === "fillRect")).toHaveLength(1);
  });
});
