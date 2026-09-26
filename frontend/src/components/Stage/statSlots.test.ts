// P2.6 `withEmptySlots`: splicing empty level slots back into a computed draw,
// and REFUSING to splice a stale draw against the wrong slots (PR #433).

import { describe, expect, it } from "vitest";

import { boxStatsClient } from "../../lib/statstage";
import type { StatDrawData } from "./statRender";
import { withEmptySlots } from "./statSlots";

const box = (label: string, values: number[]) => boxStatsClient(values, 1.5, label);
const draw = (...boxes: ReturnType<typeof box>[]): StatDrawData => ({
  mode: "box", boxes, valueLabel: "y", groupLabel: "lot",
});
// Slots A (2 values), B (empty), C (3 values).
const SLOTS = [
  { label: "lot = A", values: [1, 2] },
  { label: "lot = B", values: [] },
  { label: "lot = C", values: [3, 4, 5] },
];
const LABELS = ["n=2", "n=0", "n=3"];

describe("withEmptySlots", () => {
  it("splices an n=0 placeholder into each empty slot of a MATCHING draw", () => {
    const out = withEmptySlots(draw(box("lot = A", [1, 2]), box("lot = C", [3, 4, 5])), SLOTS, LABELS);
    if (out?.mode !== "box") throw new Error("expected box");
    expect(out.boxes.map((b) => [b.label, b.n])).toEqual([["lot = A", 2], ["lot = B", 0], ["lot = C", 3]]);
    expect(out.countLabels).toEqual(LABELS);
  });

  it("leaves a STALE draw with the same filled COUNT but different labels unspliced", () => {
    // The previous pick (e.g. before a nesting/filter change) also had two
    // filled groups; a count-only guard spliced its boxes one slot off.
    const stale = draw(box("lot = B", [7, 8]), box("lot = C", [3, 4, 5]));
    expect(withEmptySlots(stale, SLOTS, LABELS)).toBe(stale);
  });

  it("leaves a stale draw with the same labels but different n unspliced", () => {
    const stale = draw(box("lot = A", [1, 2, 9]), box("lot = C", [3, 4, 5]));
    expect(withEmptySlots(stale, SLOTS, LABELS)).toBe(stale);
  });

  it("applies the same label check to violins", () => {
    const v = (label: string, n: number) => ({ label, x: [0], density: [1], quartiles: [0, 0, 0] as [number, number, number], n });
    const stale: StatDrawData = { mode: "violin", violins: [v("lot = X", 2), v("lot = C", 3)], valueLabel: "y", groupLabel: "lot" };
    expect(withEmptySlots(stale, SLOTS, LABELS)).toBe(stale);
    const fresh: StatDrawData = { ...stale, violins: [v("lot = A", 2), v("lot = C", 3)] };
    const out = withEmptySlots(fresh, SLOTS, LABELS);
    expect(out?.mode === "violin" && out.violins.map((x) => x.label)).toEqual(["lot = A", "lot = B", "lot = C"]);
  });
});
