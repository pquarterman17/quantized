// Cross-reference consistency: holders OUTSIDE the dataset/window/editable-
// figure trio that `removeFormula` already remaps. A legacy publication
// FigureDoc (`figureDocs`) and a saved Graph Builder spec (`savedPlotSpecs`)
// both name columns by plain index; left alone, a removed column made a LIVE
// doc or a reopened saved graph plot whatever slid into the old slot.

import { beforeEach, describe, expect, it } from "vitest";

import type { ErrorBinding } from "../lib/errorRoles";
import type { FigureConfig, FigureDoc } from "../lib/figuredoc";
import { emptySpec, type PlotSpec, type SavedPlotSpec } from "../lib/plotspec";
import type { ComputedColumn, Dataset } from "../lib/types";
import { useApp } from "./useApp";

// Base A(0), formulas F1(1) F2(2) F3(3).
function ds(id = "a"): Dataset {
  const formulas: ComputedColumn[] = [
    { name: "F1", expr: "A * 1", deps: ["A"] },
    { name: "F2", expr: "A * 2", deps: ["A"] },
    { name: "F3", expr: "A * 3", deps: ["A"] },
  ];
  const labels = ["A", ...formulas.map((f) => f.name)];
  return {
    id,
    name: id,
    data: {
      time: [0, 1],
      values: [
        [1, 1, 2, 3],
        [2, 2, 4, 6],
      ],
      labels,
      units: labels.map(() => ""),
      metadata: {},
    },
    formulas,
  };
}

const cfg = (over: Partial<FigureConfig> = {}): FigureConfig => ({
  xKey: null,
  yKeys: null,
  xScale: "linear",
  yScale: "linear",
  title: "",
  xLabel: "",
  yLabel: "",
  style: "screen",
  fmt: "png",
  dpi: 300,
  overrides: null,
  seriesStyles: null,
  ...over,
});

const doc = (config: FigureConfig, datasetId = "a"): FigureDoc => ({
  id: "fd1",
  name: "fd1",
  datasetId,
  config,
  live: true,
});

const labelsOf = (keys: readonly number[] | null | undefined): string[] =>
  (keys ?? []).map((k) => useApp.getState().datasets[0].data.labels[k]);

beforeEach(() => {
  useApp.setState({
    datasets: [ds()],
    activeId: null,
    plotWindows: [],
    focusedWindowId: null,
    editableFigures: [],
    figureDocs: [],
    savedPlotSpecs: [],
    status: "",
  });
});

describe("removeFormula: a live legacy FigureDoc follows the shift", () => {
  it("keeps plotting F3 against F2 after F1 is removed", () => {
    useApp.setState({ figureDocs: [doc(cfg({ xKey: 2, yKeys: [3], groupCol: 2 }))] });
    useApp.getState().removeFormula("a", 0); // F1, column 1
    const c = useApp.getState().figureDocs[0].config;
    expect(labelsOf(c.xKey === null ? [] : [c.xKey])).toEqual(["F2"]);
    expect(labelsOf(c.yKeys)).toEqual(["F3"]);
    expect(c.groupCol).toBe(1);
  });

  it("drops the removed column's series and its positional style together", () => {
    const styles = [{ color: "#111" }, { color: "#222" }] as FigureConfig["seriesStyles"];
    useApp.setState({ figureDocs: [doc(cfg({ yKeys: [1, 3], seriesStyles: styles }))] });
    useApp.getState().removeFormula("a", 0);
    const c = useApp.getState().figureDocs[0].config;
    expect(labelsOf(c.yKeys)).toEqual(["F3"]);
    expect(c.seriesStyles).toEqual([{ color: "#222" }]); // F3 keeps ITS style
  });

  it("drops an error binding on the removed column and shifts the rest", () => {
    const errors: ErrorBinding[] = [
      { channel: 1, target: 3, axis: "y", side: "both" },
      { channel: 2, target: 3, axis: "y", side: "both" },
    ];
    useApp.setState({ figureDocs: [doc(cfg({ yKeys: [3], errors }))] });
    useApp.getState().removeFormula("a", 0);
    expect(useApp.getState().figureDocs[0].config.errors).toEqual([{ channel: 1, target: 2, axis: "y", side: "both" }]);
  });

  it("leaves a doc on another dataset, or a frozen one, untouched", () => {
    const other = doc(cfg({ yKeys: [3] }), "b");
    const frozen = { ...doc(cfg({ yKeys: [3] })), id: "fz", live: false, dataSnapshot: ds().data };
    useApp.setState({ datasets: [ds(), ds("b")], figureDocs: [other, frozen] });
    useApp.getState().removeFormula("a", 0);
    expect(useApp.getState().figureDocs).toEqual([other, frozen]);
  });
});

describe("removeFormula: a saved Graph Builder spec follows the shift", () => {
  const ref = (channel: number, datasetId = "a") => ({ datasetId, channel });
  const saved = (spec: PlotSpec): SavedPlotSpec => ({
    id: "ps1",
    name: "g",
    createdAt: "t",
    modifiedAt: "t",
    spec,
  });

  it("re-points every zone at the same column, and drops the removed one", () => {
    const spec: PlotSpec = {
      ...emptySpec(),
      zones: { x: ref(2), y: [ref(1), ref(3)], group: ref(1), facet: null, yErr: [], xErr: null, color: ref(3) },
    };
    useApp.setState({ savedPlotSpecs: [saved(spec)] });
    useApp.getState().removeFormula("a", 0);
    const z = useApp.getState().savedPlotSpecs[0].spec.zones;
    expect(z.x).toEqual(ref(1)); // F2
    expect(z.y).toEqual([ref(2)]); // F3 only; F1 is gone
    expect(z.group).toBeNull();
    expect(z.color).toEqual(ref(2));
  });

  it("never re-pairs a Y error onto a different Y", () => {
    // y = [F2, F3], yErr = [F1 (for F2), A (for F3)]: F1's removal must not
    // slide A's pairing onto F2.
    const spec: PlotSpec = {
      ...emptySpec(),
      zones: { x: null, y: [ref(2), ref(3)], group: null, facet: null, yErr: [ref(1), ref(0)], xErr: null },
    };
    useApp.setState({ savedPlotSpecs: [saved(spec)] });
    useApp.getState().removeFormula("a", 0);
    const z = useApp.getState().savedPlotSpecs[0].spec.zones;
    expect(z.y).toEqual([ref(1), ref(2)]);
    expect(z.yErr).toEqual([]);
  });

  it("leaves a spec on another dataset untouched", () => {
    const spec: PlotSpec = { ...emptySpec(), zones: { ...emptySpec().zones, y: [ref(3, "b")] } };
    const entry = saved(spec);
    useApp.setState({ datasets: [ds(), ds("b")], savedPlotSpecs: [entry] });
    useApp.getState().removeFormula("a", 0);
    expect(useApp.getState().savedPlotSpecs[0].spec).toBe(spec);
  });
});
