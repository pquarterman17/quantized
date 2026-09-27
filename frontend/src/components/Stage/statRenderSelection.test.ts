// statRenderSelection — the linked selection's canvas marks and the click ->
// slot mapping (PRIMARY_SOFTWARE_AUDIT_PLAN P2.6 box 4).

import { describe, expect, it } from "vitest";

import { boxStatsClient, categorySlots, finiteDomain } from "../../lib/statstage";
import type { StatDrawData } from "./statRender";
import { plotRect } from "./statRender";
import { drawStrip } from "./statRenderBox";
import { clickedSlotAt, drawSlotSelection, slotIndexAt } from "./statRenderSelection";

describe("slotIndexAt", () => {
  it("maps x to the drawn slot the renderers centre at (i + 0.5) / n", () => {
    const rect = plotRect(600, 400);
    const slots = categorySlots(4);
    slots.forEach((s, i) => {
      expect(slotIndexAt(600, 400, rect.x + s.cx * rect.w, 200, 4)).toBe(i);
    });
    // Tick-label band below the plot counts; the margins do not.
    expect(slotIndexAt(600, 400, rect.x + slots[1].cx * rect.w, rect.y + rect.h + 20, 4)).toBe(1);
    expect(slotIndexAt(600, 400, rect.x - 5, 200, 4)).toBeNull();
    expect(slotIndexAt(600, 400, 300, rect.y - 5, 4)).toBeNull();
    expect(slotIndexAt(600, 400, 300, 200, 0)).toBeNull();
  });
});

describe("clickedSlotAt", () => {
  // Two widely separated boxes so there is a genuinely blank y-band, in
  // EITHER column, between A's glyph (low values) and B's (high values) —
  // P2.6 review finding 10.
  const boxes = [boxStatsClient([10, 20], 1.5, "A"), boxStatsClient([80, 90], 1.5, "B")];
  const draw: StatDrawData = { mode: "box", boxes, valueLabel: "y", groupLabel: "g" };
  const rect = plotRect(600, 400);
  const domain = finiteDomain(boxes.map((b) => [b.whislo, b.whishi, ...b.fliers]));
  const vy = (v: number) => rect.y + rect.h - ((v - domain[0]) / (domain[1] - domain[0])) * rect.h;
  const slots = categorySlots(2);
  const xOf = (i: number) => rect.x + slots[i].cx * rect.w;

  it("a click on the box's own whisker span selects its slot", () => {
    const y = (vy(boxes[0].whislo) + vy(boxes[0].whishi)) / 2;
    expect(clickedSlotAt(draw, 600, 400, xOf(0), y, 2)).toBe(0);
    const yB = (vy(boxes[1].whislo) + vy(boxes[1].whishi)) / 2;
    expect(clickedSlotAt(draw, 600, 400, xOf(1), yB, 2)).toBe(1);
  });

  it("a click on blank background inside the plot rect — between the two boxes — selects nothing", () => {
    // Halfway between A's top edge and B's bottom edge: neither box draws
    // there, in either column.
    const yBlank = (vy(boxes[0].whishi) + vy(boxes[1].whislo)) / 2;
    expect(clickedSlotAt(draw, 600, 400, xOf(0), yBlank, 2)).toBeNull();
    expect(clickedSlotAt(draw, 600, 400, xOf(1), yBlank, 2)).toBeNull();
  });

  it("the tick-label band below the plot still counts, even over blank content", () => {
    expect(clickedSlotAt(draw, 600, 400, xOf(0), rect.y + rect.h + 10, 2)).toBe(0);
  });

  it("an EMPTY slot (no box drawn there) has no content in the plot rect — only its tick label does", () => {
    const empty: StatDrawData = {
      mode: "box",
      boxes: [boxes[0]],
      valueLabel: "y",
      groupLabel: "g",
      slots: [
        { label: "A", group: 0, n: 2, nonFinite: 0, excluded: 0, absent: false, key: "0" },
        { label: "C", group: null, n: 0, nonFinite: 0, excluded: 0, absent: true, key: "2" },
      ],
    };
    expect(clickedSlotAt(empty, 600, 400, xOf(1), rect.y + rect.h / 2, 2)).toBeNull();
    expect(clickedSlotAt(empty, 600, 400, xOf(1), rect.y + rect.h + 10, 2)).toBe(1);
  });
});

describe("selected points", () => {
  it("strip: every selected point (by its own rowIndex) gets a ring, and only those", () => {
    const rings: number[] = [];
    const noop = () => {};
    const ctx = new Proxy(
      {
        arc: (_x: number, _y: number, r: number) => {
          if (r > 3) rings.push(r);
        },
        measureText: () => ({ width: 10 }),
      } as Record<string, unknown>,
      { get: (t, k) => (k in t ? t[k as string] : typeof k === "string" && /^[a-z]/.test(k) ? noop : undefined), set: () => true },
    ) as unknown as CanvasRenderingContext2D;
    const points = [
      { label: "A", points: [{ value: 1, rowIndex: 0 }, { value: 2, rowIndex: 1 }] },
      { label: "B", points: [{ value: 3, rowIndex: 2 }] },
    ];
    drawStrip(ctx, { x: 60, y: 20, w: 500, h: 300 }, {
      mode: "strip",
      boxes: points.map((g) => boxStatsClient(g.points.map((p) => p.value), 1.5, g.label)),
      points,
      valueLabel: "y",
      groupLabel: "g",
      showMeanCI: false,
      connectMeans: false,
      selection: { slots: [1, 2], points: new Set([1, 2]) },
    }, "ink", "muted");
    expect(rings).toEqual([3.5, 3.5]);
  });
});

describe("drawSlotSelection", () => {
  it("bands only the marked slots, stronger for all than for some", () => {
    const fills: { x: number; alpha: number }[] = [];
    const dashes: number[][] = [];
    const ctx = {
      globalAlpha: 1,
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      save() {},
      restore() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      setLineDash(d: number[]) {
        dashes.push(d);
      },
      fillRect(this: { globalAlpha: number }, x: number) {
        fills.push({ x, alpha: this.globalAlpha });
      },
    } as unknown as CanvasRenderingContext2D;
    const rect = { x: 0, y: 0, w: 300, h: 100 };
    drawSlotSelection(ctx, rect, { slots: [2, 0, 1], points: new Set() }, "accent");
    expect(fills.map((f) => f.x)).toEqual([0, 200]);
    expect(fills[0].alpha).toBeGreaterThan(fills[1].alpha);
    expect(dashes).toEqual([[], [4, 3]]);
  });
});
