// Point labels (gap audit 8, LBL): column-removal remapping, the export wire and
// the saved view. The layout rules themselves: pointLabelLayout.test.ts.

import { describe, expect, it } from "vitest";

import { DEFAULT_LABEL_AVOID } from "./pointLabelAvoid";
import { remapFigureViewChannels, remapPointLabels, remapViewChannels, type ViewChannelState } from "./channelRemap";
import { defaultPlotView, sanitizePlotView } from "./plotview";
import { pointLabelLayoutFor, pointLabelsOverride, type LabelContext } from "./figurePointLabels";
import { buildFigureSpecFromDocument } from "./figureSpec";
import { createFigureDocument } from "./figureDocument";
import type { Dataset, DataStruct } from "./types";
import { useApp } from "../store/useApp";

const SPEC = { key: 3, mode: "all" as const, topN: 10 };

function view(over: Partial<ViewChannelState> = {}): ViewChannelState {
  return { xKey: 0, yKeys: [1], y2Keys: null, groupKey: null, facetKey: null, hiddenChannels: [], seriesOrder: null, seriesStyles: {}, seriesLabels: {}, errKeys: {}, ...over };
}

describe("the label column is channel-indexed state", () => {
  it("shifts down with a column removed before it, and stays when removed after it", () => {
    expect(remapPointLabels(SPEC, 2)).toEqual({ ...SPEC, key: 2 });
    expect(remapPointLabels(SPEC, 5)).toEqual(SPEC);
    expect(remapViewChannels(view({ pointLabels: SPEC }), 1).pointLabels?.key).toBe(2);
  });
  it("turns off when the label column itself is removed (no honest substitute)", () => {
    expect(remapPointLabels(SPEC, 3)).toBeNull();
    expect(remapViewChannels(view({ pointLabels: SPEC }), 3).pointLabels).toBeNull();
  });
  it("follows an inserted column and a moved column", () => {
    expect(remapPointLabels(SPEC, { inserted: 1 })?.key).toBe(4);
    expect(remapPointLabels(SPEC, { from: 3, to: 0 })?.key).toBe(0);
    expect(remapPointLabels(SPEC, { from: 0, to: 5 })?.key).toBe(2);
  });
  it("is absent-safe: a caller without the field gets none back, off stays off", () => {
    expect("pointLabels" in remapViewChannels(view(), 1)).toBe(false);
    expect(remapViewChannels(view({ pointLabels: null }), 1).pointLabels).toBeNull();
  });
  it("a saved figure document's view remaps it too", () => {
    const v = { ...defaultPlotView(), pointLabels: SPEC };
    expect(remapFigureViewChannels(v, 1).pointLabels?.key).toBe(2);
    expect(remapFigureViewChannels(v, 3).pointLabels).toBeNull();
  });
  it("the live store view follows a removed column through removeFormula's remap", () => {
    useApp.setState({ pointLabels: SPEC });
    const patch = remapViewChannels(useApp.getState() as unknown as ViewChannelState, 1);
    expect(patch.pointLabels?.key).toBe(2);
    useApp.setState({ pointLabels: null });
  });
});

describe("the saved view", () => {
  it("is off by default and survives sanitizePlotView; a malformed stored value is off", () => {
    expect(defaultPlotView().pointLabels).toBeNull();
    expect(sanitizePlotView({ ...defaultPlotView(), pointLabels: SPEC }).pointLabels).toEqual(SPEC);
    expect(sanitizePlotView({ ...defaultPlotView(), pointLabels: { key: "a", mode: "all" } }).pointLabels).toBeNull();
    expect(sanitizePlotView({}).pointLabels).toBeNull();
  });
  it("setPointLabels is one undo step and refuses a malformed value", () => {
    useApp.setState({ pointLabels: null });
    useApp.getState().setPointLabels({ key: 1, mode: "top", topN: 4 });
    expect(useApp.getState().pointLabels).toEqual({ key: 1, mode: "top", topN: 4 });
    useApp.getState().undo();
    expect(useApp.getState().pointLabels).toBeNull();
    useApp.getState().setPointLabels({ key: -2, mode: "top", topN: 4 });
    expect(useApp.getState().pointLabels).toBeNull();
  });
});

function ds(): Dataset {
  const data: DataStruct = {
    time: [0, 1, 2, 3, 4],
    values: [[1, 10], [4, 11], [9, 12], [16, 13], [25, 14]],
    labels: ["y", "id"],
    units: ["", ""],
    metadata: {},
  };
  return { id: "d", name: "d", data, excludedRows: [2] } as unknown as Dataset;
}

function ctx(over: Partial<LabelContext> = {}): Omit<LabelContext, "selected"> {
  const dataset = ds();
  return {
    dataset,
    view: { ...defaultPlotView(), xKey: null, yKeys: [0] },
    spec: { key: 1, mode: "all", topN: 10 },
    groupKey: null,
    encoding: undefined,
    ...over,
  };
}

describe("the export wire (the same layout the canvas runs)", () => {
  it("carries the laid-out list, leaving the excluded row out, and nothing when off", () => {
    const wire = pointLabelsOverride(undefined, ctx(), false)?.point_labels;
    expect(wire?.points.map((p) => p.text).sort()).toEqual(["10", "11", "13", "14"]);
    expect(pointLabelsOverride(undefined, ctx({ spec: null }), false)).toBeUndefined();
    const base = { grid: true };
    expect(pointLabelsOverride(base, ctx({ spec: null }), false)).toBe(base);
  });

  it("is exactly the canvas layout's points (screen == export)", () => {
    const c = ctx();
    const canvas = pointLabelLayoutFor({ ...c, selected: null });
    const wire = pointLabelsOverride(undefined, c, false)?.point_labels;
    expect(wire?.points).toEqual(canvas.points.map(({ x, y, text, s }) => ({ x, y, text, s })));
  });

  it("sends none with x breaks, and names a refusal instead of drawing", () => {
    expect(pointLabelsOverride(undefined, ctx(), true)).toBeUndefined();
    const refused = pointLabelsOverride(undefined, ctx({ view: { ...defaultPlotView(), xKey: null, yKeys: [0], exchangeXY: true } }), false);
    expect(refused?.point_labels?.points).toEqual([]);
    expect(refused?.point_labels?.note).toMatch(/^Point labels are not drawn with exchanged/);
  });

  it("'selected rows' reads the worksheet selection of THIS dataset only", () => {
    const c = ctx({ spec: { key: 1, mode: "selected", topN: 10 } });
    useApp.setState({ selection: { datasetId: "other", rows: [0, 1] } });
    expect(pointLabelsOverride(undefined, c, false)).toBeUndefined(); // another dataset's selection is not this graph's
    useApp.setState({ selection: { datasetId: "d", rows: [0, 1, 2] } });
    expect(pointLabelsOverride(undefined, c, false)?.point_labels?.points.map((p) => p.text).sort()).toEqual(["10", "11"]); // row 2 is excluded
    // no selection (or a saved figure with no worksheet): no labels and no "select rows" hint in the export
    useApp.setState({ selection: null });
    expect(pointLabelsOverride(undefined, c, false)).toBeUndefined();
    expect(pointLabelsOverride(undefined, { ...c, dataset: null, data: ds().data }, false)).toBeUndefined();
  });

  it("hidden curves and a group split are respected", () => {
    const hidden = ctx({ view: { ...defaultPlotView(), xKey: null, yKeys: [0], hiddenChannels: [0] } });
    expect(pointLabelsOverride(undefined, hidden, false)?.point_labels?.points ?? []).toEqual([]);
    const grouped = pointLabelsOverride(undefined, ctx({ groupKey: 1 }), false);
    expect(grouped?.point_labels?.note).toMatch(/group, encoding, facet or secondary/);
  });
});

describe("through buildFigureSpec (the real export request)", () => {
  it("excluded rows and the data filter are left out of the wire, and rows keep the dataset's own indexing", () => {
    const dataset = {
      ...ds(),
      excludedRows: [3],
      filter: [{ col: 0, kind: "range", min: 10 }], // drops rows whose y < 10: rows 0..2
    } as unknown as Dataset;
    const view = { ...defaultPlotView(), xKey: null, yKeys: [0], pointLabels: { key: 1, mode: "all" as const, topN: 10 } };
    const doc = createFigureDocument({ id: "pl", name: "PL", datasetId: "d", view });
    const spec = buildFigureSpecFromDocument(doc, dataset, "f");
    const texts = spec.overrides?.point_labels?.points.map((p) => p.text).sort();
    // rows 0..2 are filtered out and row 3 is excluded: only row 4 (label "14") is left
    expect(texts).toEqual(["14"]);
  });

  it("a graph with labels off sends no point_labels at all", () => {
    const doc = createFigureDocument({ id: "pl2", name: "PL", datasetId: "d", view: { ...defaultPlotView(), xKey: null, yKeys: [0] } });
    expect(buildFigureSpecFromDocument(doc, ds(), "f").overrides?.point_labels).toBeUndefined();
  });
});

describe("Avoid overlaps (plan item 18): the setting and the export wire", () => {
  const AVOID = { leaderDistance: 2.5, leaderWidth: 1.25, leaderDashed: true };
  const roundTrip = (pl: unknown) => sanitizePlotView(JSON.parse(JSON.stringify({ ...defaultPlotView(), pointLabels: pl })) as unknown).pointLabels;

  it("survives save and reopen, and an older project (no `avoid`) opens exactly as before", () => {
    expect(roundTrip({ ...SPEC, avoid: AVOID })).toEqual({ ...SPEC, avoid: AVOID });
    expect(roundTrip(SPEC)).toEqual(SPEC);
    expect("avoid" in (roundTrip(SPEC) ?? {})).toBe(false);
  });

  it("a damaged option falls back per field; a non-object is off", () => {
    expect(roundTrip({ ...SPEC, avoid: { leaderDistance: -1, leaderWidth: "x", leaderDashed: 1 } })).toEqual({ ...SPEC, avoid: DEFAULT_LABEL_AVOID });
    expect(roundTrip({ ...SPEC, avoid: "yes" })).toEqual(SPEC);
  });

  it("follows a column removal (the option rides along with the label column)", () => {
    expect(remapPointLabels({ ...SPEC, avoid: AVOID }, 2)).toEqual({ ...SPEC, key: 2, avoid: AVOID });
  });

  it("is sent to the export only when on, and the canvas layout carries it", () => {
    expect(pointLabelsOverride(undefined, ctx(), false)?.point_labels?.avoid).toBeUndefined();
    const on = ctx({ spec: { key: 1, mode: "all", topN: 10, avoid: AVOID } });
    expect(pointLabelsOverride(undefined, on, false)?.point_labels?.avoid).toEqual({ leader_distance: 2.5, leader_width: 1.25, leader_dashed: true });
    expect(pointLabelLayoutFor({ ...on, selected: null }).avoid).toEqual(AVOID);
    expect("avoid" in pointLabelLayoutFor({ ...ctx(), selected: null })).toBe(false);
  });
});

describe("a text-column source (plan item 47 follow-up)", () => {
  const TEXT = { key: -1, text: "Name", mode: "all" as const, topN: 10 };
  const roundTrip = (pl: unknown) => sanitizePlotView(JSON.parse(JSON.stringify({ ...defaultPlotView(), pointLabels: pl })) as unknown).pointLabels;

  it("is picked by name: it survives save and reopen, and an empty or non-string name is not a text source", () => {
    expect(roundTrip(TEXT)).toEqual(TEXT);
    expect(roundTrip({ ...TEXT, key: 7 })).toEqual(TEXT); // the name wins; the key is the -1 placeholder
    expect(roundTrip({ key: -1, text: "", mode: "all" })).toBeNull();
    expect(roundTrip({ key: 2, text: 5, mode: "all" })).toEqual({ key: 2, mode: "all", topN: 10 });
  });

  it("no channel insert, move or removal moves or turns off a text source", () => {
    for (const shift of [0, 3, { inserted: 0 }, { from: 0, to: 5 }] as const) {
      expect(remapPointLabels(TEXT, shift)).toBe(TEXT);
      expect(remapViewChannels(view({ pointLabels: TEXT }), shift).pointLabels).toBe(TEXT);
    }
    expect(remapFigureViewChannels({ ...defaultPlotView(), pointLabels: TEXT }, 1).pointLabels).toEqual(TEXT);
  });
});
