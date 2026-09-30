// P1.4 residual 3 — the Graph Builder's encodings on box / violin / bar: what a
// Color pick does to the axis (lib/plotEncodingStat.statPlan / statSeed) and
// the one-sentence refusal for every encoding those marks cannot draw.

import { describe, expect, it } from "vitest";

import { encodingChip, encodingNotes, encodingRef } from "../components/workshops/graphbuilder/encodingWellModel";
import { statEncodingRefusal, statPlan, statPlanRender, statSeed } from "./plotEncodingStat";
import type { PlotSpec } from "./plotspec";
import type { Dataset } from "./types";

// ch0 lot (categorical), ch1 wafer (categorical), ch2 y, ch3 T (continuous), ch4 y2.
const DS: Dataset = {
  id: "ps",
  name: "ps.csv",
  data: {
    time: [0, 1, 2, 3, 4, 5],
    values: [[0, 0, 1, 10, 5], [0, 1, 2, 11, 6], [1, 0, 3, 12, 7], [1, 1, 4, 13, 8], [0, 0, 1.5, 14, 9], [1, 1, 4.5, 15, 3]],
    labels: ["lot", "wafer", "y", "T", "y2"],
    units: ["", "", "", "K", ""],
    metadata: { text_columns: { note: ["a", "b", "a", "b", "a", "b"] } },
    cat_levels: { 0: ["L1", "L2"], 1: ["W1", "W2"] },
  },
};
const ref = (channel: number) => ({ datasetId: "ps", channel });
const spec = (mark: PlotSpec["mark"], zones: Partial<PlotSpec["zones"]> = {}): PlotSpec => ({
  version: 1,
  zones: { x: ref(0), y: [ref(2)], group: null, facet: null, yErr: [], xErr: null, ...zones },
  mark,
});
const why = (s: PlotSpec, zone: "color" | "symbol" | "label", channel: number) =>
  statEncodingRefusal(s, DS, zone, ref(channel));

describe("statEncodingRefusal — one sentence per encoding a categorical mark cannot draw", () => {
  it("Symbol and Label never apply to box / violin / bar", () => {
    for (const mark of ["box", "violin", "bar"] as const) {
      expect(why(spec(mark), "symbol", 1)).toBe("Box, violin and bar draw no per-series marker, so Symbol does not apply.");
      expect(why(spec(mark), "label", 3)).toBe("Box, violin and bar name their groups on the axis, so Label does not apply.");
    }
  });

  it("Color: categorical applies; a gradient or a text column does not", () => {
    expect(why(spec("box"), "color", 1)).toBeNull();
    expect(why(spec("violin"), "color", 0)).toBeNull();
    expect(why(spec("box"), "color", 3)).toBe("A gradient colours single points, which box, violin and bar do not draw.");
    expect(statEncodingRefusal(spec("box"), DS, "color", { datasetId: "ps", channel: -1, text: "note" })).toBe(
      "Box, violin and bar colour by a column of the sheet, not a text column.",
    );
  });

  it("bar: Color must be the X category, with one Y column", () => {
    expect(why(spec("bar"), "color", 0)).toBeNull();
    expect(why(spec("bar"), "color", 1)).toBe("A bar's colour can only follow its X category.");
    expect(why(spec("bar", { y: [ref(2), ref(4)] }), "color", 0)).toBe(
      "With several Y columns, bar colour already tells the columns apart.",
    );
  });

  it("xy marks are not this module's business", () => {
    expect(why(spec("scatter"), "symbol", 1)).toBeNull();
  });
});

describe("statPlan / statSeed — what a Color pick does to the axis", () => {
  it("Color on X colours X; on another column it nests X; with no categorical X it becomes the axis", () => {
    expect(statPlan(spec("box", { color: ref(0) }), DS)).toEqual({ groupCol: 0, group2Col: null, colorCol: 0 });
    expect(statPlan(spec("box", { color: ref(1) }), DS)).toEqual({ groupCol: 0, group2Col: 1, colorCol: 1 });
    expect(statPlan(spec("violin", { x: null, color: ref(1) }), DS)).toEqual({ groupCol: 1, group2Col: null, colorCol: 1 });
    // A refused pick changes nothing.
    expect(statPlan(spec("bar", { color: ref(1) }), DS)).toEqual({ groupCol: 0, group2Col: null, colorCol: null });
    expect(statPlan(spec("box", { color: ref(3) }), DS)).toEqual({ groupCol: 0, group2Col: null, colorCol: null });
  });

  it("the seed carries the nest and the colour only when Color applies (older seeds are unchanged)", () => {
    expect(statSeed(spec("box"), DS)).toEqual({ mode: "box", groupCol: 0, valueCol: 2, facetCol: null });
    expect(statSeed(spec("bar", { facet: ref(1) }), DS)).toEqual({ mode: "bar", groupCol: 0, valueCol: 2, facetCol: 1 });
    expect(statSeed(spec("violin", { color: ref(1) }), DS)).toEqual({
      mode: "violin", groupCol: 0, valueCol: 2, facetCol: null, group2Col: 1, colorCol: 1,
    });
  });

  it("the preview render nests the boxes by the Color column (none when Color changes nothing)", () => {
    const r = statPlanRender(spec("box", { color: ref(1) }), [DS]);
    if (r?.kind !== "box") throw new Error("expected a box render");
    expect(r.boxes.map((b) => b.label)).toEqual([
      "lot = L1 / wafer = W1", "lot = L1 / wafer = W2", "lot = L2 / wafer = W1", "lot = L2 / wafer = W2",
    ]);
    expect(r.groupLabel).toBe("lot / wafer");
    expect(statPlanRender(spec("box", { color: ref(0) }), [DS])).toBeNull();
    expect(statPlanRender(spec("box"), [DS])).toBeNull();
  });
});

describe("the Graph Builder wells refuse, and say why", () => {
  it("a drop the mark cannot draw is refused with its sentence; a valid one is stored", () => {
    expect(encodingRef(DS, "symbol", 1, spec("box"))).toBe(
      "Box, violin and bar draw no per-series marker, so Symbol does not apply.",
    );
    expect(encodingRef(DS, "symbol", 3, spec("bar"))).toBe(
      "Box, violin and bar draw no per-series marker, so Symbol does not apply.",
    );
    expect(encodingRef(DS, "color", 1, spec("box"))).toEqual(ref(1));
    expect(encodingRef(DS, "symbol", 1, spec("scatter"))).toEqual(ref(1));
  });

  it("a pick that stopped applying (the mark changed) reads (ignored), and the notes say why", () => {
    const s = spec("bar", { symbol: ref(1), color: ref(1) });
    expect(encodingChip(DS, "symbol", ref(1), s).label).toBe("wafer (ignored)");
    expect(encodingChip(DS, "color", ref(1), s).label).toBe("wafer (ignored)");
    expect(encodingNotes(DS, s)).toEqual([
      "A bar's colour can only follow its X category.",
      "Box, violin and bar draw no per-series marker, so Symbol does not apply.",
    ]);
    expect(encodingNotes(DS, spec("box", { color: ref(1) }))).toEqual([]);
  });
});
