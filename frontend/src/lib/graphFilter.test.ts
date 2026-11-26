// Item 22: filter plotted data from the graph. The plan is an ordinary Data
// Filter range predicate, per SOURCE sheet, failing closed.

import { describe, expect, it } from "vitest";

import type { RebindState } from "./curveRebind";
import { planViewFilter } from "./graphFilter";
import type { Dataset } from "./types";

const sheet: Dataset = {
  id: "a", name: "A", data: { time: [0, 1, 2], values: [[1, 5], [2, 6], [3, 7]], labels: ["P", "Q"], units: ["", ""], metadata: {} },
};
const base = (over: Partial<RebindState> = {}, lim: { xLim: [number | null, number | null] | null; yLim: [number | null, number | null] | null } = { xLim: [0.5, 1.5], yLim: null }) => ({
  datasets: [sheet], activeId: "a", xKey: null, yKeys: [0], seriesOrder: [], hiddenChannels: [], seriesLabels: {}, workbooks: [], ...over, ...lim,
});

describe("planViewFilter", () => {
  it("keeps the plotted X range on the source's own X, keeping other predicates", () => {
    const withOther = { ...sheet, filter: [{ col: 1, kind: "range" as const, min: 0 }] };
    const plan = planViewFilter(base({ datasets: [withOther] }), false);
    expect(plan).toMatchObject({ ok: true, edits: [{ datasetId: "a", filter: [{ col: 1, kind: "range", min: 0 }, { col: -1, kind: "range", min: 0.5, max: 1.5 }] }] });
  });
  it("replaces an earlier range on the same column (a repeat is stable)", () => {
    const once = planViewFilter(base(), false);
    if (!once.ok) throw new Error("plan");
    const again = planViewFilter(base({ datasets: [{ ...sheet, filter: once.edits[0].filter }] }), false);
    expect(again).toMatchObject({ ok: true, edits: [{ filter: once.edits[0].filter }] });
  });
  it("adds the Y range of a single visible curve, on that curve's column", () => {
    const plan = planViewFilter(base({}, { xLim: [0, 2], yLim: [1.5, 2.5] }), true);
    expect(plan).toMatchObject({ ok: true, edits: [{ filter: [{ col: -1, min: 0, max: 2 }, { col: 0, min: 1.5, max: 2.5 }] }] });
  });
  it("refuses an auto range, a Y filter over several curves and a half-open range", () => {
    expect(planViewFilter(base({}, { xLim: null, yLim: null }), false)).toMatchObject({ ok: false });
    expect(planViewFilter(base({ yKeys: [0, 1] }, { xLim: [0, 2], yLim: [0, 9] }), true)).toMatchObject({ ok: false });
    expect(planViewFilter(base({}, { xLim: [0, null], yLim: null }), false)).toMatchObject({ ok: false });
  });
});
