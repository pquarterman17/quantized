import { beforeEach, describe, expect, it } from "vitest";

import {
  remapChannel,
  remapChannelList,
  remapDatasetChannels,
  remapErrorRoles,
  remapFigureBindings,
  remapFitSpec,
  remapKeyedRecord,
  remapViewChannels,
  remapWindowViews,
  type ViewChannelState,
} from "./channelRemap";
import type { ErrorBinding } from "./errorRoles";
import { fitDataForSpec } from "./fitselection";
import { dyForFit } from "./fitweights";
import type { FigureBindings } from "./figureDocument";
import { useApp } from "../store/useApp";
import type { ComputedColumn, DataStruct, Dataset, FitSpec, SeriesStyle } from "./types";

const style = (color: string): SeriesStyle => ({ color }) as SeriesStyle;

function view(over: Partial<ViewChannelState> = {}): ViewChannelState {
  return {
    xKey: 0,
    yKeys: [3, 4],
    y2Keys: null,
    groupKey: null,
    facetKey: null,
    hiddenChannels: [],
    seriesOrder: null,
    seriesStyles: {},
    seriesLabels: {},
    errKeys: {},
    ...over,
  };
}

describe("remapChannel", () => {
  it("drops the removed column, shifts later ones down, leaves earlier ones", () => {
    expect(remapChannel(3, 3)).toBeNull();
    expect(remapChannel(4, 3)).toBe(3);
    expect(remapChannel(2, 3)).toBe(2);
  });
});

describe("remapChannelList / remapKeyedRecord", () => {
  it("drops the removed entry and shifts the rest", () => {
    expect(remapChannelList([2, 3, 4, 5], 3)).toEqual([2, 3, 4]);
    expect(remapKeyedRecord({ 2: "a", 3: "b", 4: "c" }, 3)).toEqual({ 2: "a", 3: "c" });
  });

  it("collapses an emptied record to undefined (the store's absent-not-empty rule)", () => {
    expect(remapKeyedRecord({ 3: "only" }, 3)).toBeUndefined();
    expect(remapKeyedRecord(undefined, 3)).toBeUndefined();
  });
});

describe("remapDatasetChannels", () => {
  it("remaps roles/types and drops a filter on the removed column", () => {
    const out = remapDatasetChannels(
      {
        channelRoles: { 3: "x", 4: "y" } as never,
        channelTypes: { 4: "continuous" } as never,
        filter: [
          { col: 3, min: 0, max: 1 },
          { col: 4, min: 0, max: 1 },
        ] as never,
      },
      3,
    );
    expect(out.channelRoles).toEqual({ 3: "y" });
    expect(out.channelTypes).toEqual({ 3: "continuous" });
    expect(out.filter).toEqual([{ col: 3, min: 0, max: 1 }]);
  });

  it("remaps errorRoles alongside the other dataset-scoped fields (BUG 1)", () => {
    const out = remapDatasetChannels(
      { errorRoles: [{ channel: 4, target: 0, axis: "y", side: "both" }] },
      3,
    );
    expect(out.errorRoles).toEqual([{ channel: 3, target: 0, axis: "y", side: "both" }]);
  });

  it("remaps fitSpec alongside the other dataset-scoped fields (round 2 finding 1)", () => {
    const out = remapDatasetChannels({ fitSpec: { model: "Linear", yKey: 4 } }, 3);
    expect(out.fitSpec).toEqual({ model: "Linear", yKey: 3 });
  });

  // F2: the chokepoint every store call site goes through must carry
  // weight.errKey too, not just direct remapFitSpec callers.
  it("carries fitSpec.weight.errKey through the chokepoint (F2)", () => {
    const out = remapDatasetChannels(
      { fitSpec: { model: "Linear", yKey: 1, weight: { mode: "yerr", errKey: 3 } } },
      2,
    );
    expect(out.fitSpec?.weight?.errKey).toBe(2);
  });
});

describe("remapFitSpec (round 2 finding 1: Dataset.fitSpec was not remapped at all)", () => {
  it("shifts a surviving yKey down with it", () => {
    expect(remapFitSpec({ model: "Linear", yKey: 4 }, 3)).toEqual({ model: "Linear", yKey: 3 });
  });

  it("drops the whole spec when yKey WAS the removed column -- no honest shifted or defaulted value exists", () => {
    expect(remapFitSpec({ model: "Linear", yKey: 3 }, 3)).toBeUndefined();
  });

  it("clears xKey to undefined (not null) when xKey WAS the removed column, keeping a surviving yKey", () => {
    const out = remapFitSpec({ model: "Linear", xKey: 3, yKey: 5 }, 3);
    expect(out?.xKey).toBeUndefined();
    expect(out?.yKey).toBe(4);
  });

  it("shifts a surviving xKey down with it", () => {
    expect(remapFitSpec({ model: "Linear", xKey: 4, yKey: 5 }, 3)?.xKey).toBe(3);
  });

  it("leaves an explicit xKey: null (deliberately the time axis) untouched", () => {
    expect(remapFitSpec({ model: "Linear", xKey: null, yKey: 5 }, 3)?.xKey).toBeNull();
  });

  it("leaves a legacy spec with no recorded yKey untouched -- xKey alone is meaningless without it", () => {
    const legacy: FitSpec = { model: "Linear" };
    expect(remapFitSpec(legacy, 3)).toEqual(legacy);
  });

  it("passes undefined through", () => {
    expect(remapFitSpec(undefined, 3)).toBeUndefined();
  });

  // F2 (SILENT_STATE_CORRUPTION_PLAN): `weight.errKey` is a channel index too --
  // `dyForFit`'s only guard is `errKey < 0 || errKey >= width`, so an in-range
  // but now-WRONG index passes silently and `stampRecompute` stamps the wrong
  // fit's params back onto the saved spec.
  it("shifts a surviving weight.errKey down with the removed column", () => {
    const out = remapFitSpec({ model: "Linear", yKey: 1, weight: { mode: "manual", errKey: 3 } }, 2);
    expect(out?.weight?.errKey).toBe(2);
  });

  it("drops the whole weight (falls back to unweighted) when errKey WAS the removed column, keeping yKey", () => {
    const out = remapFitSpec({ model: "Linear", yKey: 1, weight: { mode: "manual", errKey: 3 } }, 3);
    expect(out?.yKey).toBe(1);
    expect(out?.weight).toBeUndefined();
  });

  it("leaves weight untouched when errKey is below the removed column", () => {
    const out = remapFitSpec({ model: "Linear", yKey: 5, weight: { mode: "yerr", errKey: 1 } }, 3);
    expect(out?.weight).toEqual({ mode: "yerr", errKey: 1 });
  });

  it("leaves a spec with no weight untouched", () => {
    const out = remapFitSpec({ model: "Linear", yKey: 4 }, 3);
    expect(out?.weight).toBeUndefined();
  });
});

describe("remapFigureBindings (round 2 finding 2: a saved FigureDocument's bindings were not remapped at all)", () => {
  const bindings = (over: Partial<FigureBindings> = {}): FigureBindings => ({
    datasetId: "d1",
    xKey: null,
    yKeys: null,
    y2Keys: null,
    groupKey: null,
    facetKey: null,
    errors: [],
    ...over,
  });

  it("shifts surviving xKey/yKeys/y2Keys/groupKey/facetKey down", () => {
    const out = remapFigureBindings(
      bindings({ xKey: 4, yKeys: [4, 5], y2Keys: [5], groupKey: 5, facetKey: 4 }),
      3,
    );
    expect(out.xKey).toBe(3);
    expect(out.yKeys).toEqual([3, 4]);
    expect(out.y2Keys).toEqual([4]);
    expect(out.groupKey).toBe(4);
    expect(out.facetKey).toBe(3);
  });

  it("nulls xKey/groupKey/facetKey and drops from yKeys/y2Keys when the removed column WAS the bound one", () => {
    const out = remapFigureBindings(bindings({ xKey: 3, yKeys: [3], y2Keys: [3], groupKey: 3, facetKey: 3 }), 3);
    expect(out.xKey).toBeNull();
    expect(out.yKeys).toEqual([]);
    expect(out.y2Keys).toEqual([]);
    expect(out.groupKey).toBeNull();
    expect(out.facetKey).toBeNull();
  });

  it("remaps errors the same way Dataset.errorRoles does", () => {
    const out = remapFigureBindings(bindings({ errors: [{ channel: 4, target: 0, axis: "y", side: "both" }] }), 3);
    expect(out.errors).toEqual([{ channel: 3, target: 0, axis: "y", side: "both" }]);
  });

  it("leaves a binding with nothing above the removed column untouched", () => {
    const out = remapFigureBindings(bindings({ xKey: 0, yKeys: [1] }), 5);
    expect(out.xKey).toBe(0);
    expect(out.yKeys).toEqual([1]);
  });
});

describe("remapErrorRoles (BUG 1: Dataset.errorRoles was not remapped at all)", () => {
  const binding = (over: Partial<ErrorBinding>): ErrorBinding => ({
    channel: 4,
    target: 0,
    axis: "y",
    side: "both",
    ...over,
  });

  it("shifts a surviving error column (`channel`) down with it", () => {
    const out = remapErrorRoles([binding({ channel: 4, target: 0 })], 3);
    expect(out).toEqual([binding({ channel: 3, target: 0 })]);
  });

  it("shifts a surviving `target` down too -- it is channel-indexed on BOTH ends", () => {
    const out = remapErrorRoles([binding({ channel: 5, target: 4 })], 3);
    expect(out).toEqual([binding({ channel: 4, target: 3 })]);
  });

  it("drops a binding whose error column (`channel`) WAS the removed column", () => {
    const out = remapErrorRoles([binding({ channel: 3, target: 0 })], 3);
    expect(out).toEqual([]);
  });

  it("drops a binding whose `target` WAS the removed column", () => {
    const out = remapErrorRoles([binding({ channel: 5, target: 3 })], 3);
    expect(out).toEqual([]);
  });

  it("leaves the `target: -1` x-axis sentinel untouched -- it is not a column index", () => {
    // A naive remap would treat -1 as "channel 0" and shift or drop it.
    const out = remapErrorRoles([binding({ channel: 5, target: -1, axis: "x" })], 3);
    expect(out).toEqual([binding({ channel: 4, target: -1, axis: "x" })]);
  });

  it("passes an undefined errorRoles through untouched", () => {
    expect(remapErrorRoles(undefined, 3)).toBeUndefined();
  });

  it("preserves a deliberate empty array (O1 marker) rather than collapsing to undefined", () => {
    // originBookRoles.ts's `{ errorRoles: [] }` means "no error columns,
    // do NOT fall back to the label guesser" -- collapsing an emptied-out
    // remap to `undefined` would silently re-enable that guesser.
    expect(remapErrorRoles([], 3)).toEqual([]);
  });

  it("an explicit binding set that remaps down to zero survivors stays [], not undefined", () => {
    const out = remapErrorRoles([binding({ channel: 3, target: 0 })], 3);
    expect(out).toEqual([]);
    expect(out).not.toBeUndefined();
  });
});

describe("remapViewChannels", () => {
  it("shifts a surviving channel's style down with it", () => {
    // The reported bug's core: F2's style was keyed at 4; after F1 (col 3) is
    // removed F2 IS column 3, so its style has to move with it.
    const out = remapViewChannels(view({ seriesStyles: { 4: style("red") } }), 3);
    expect(out.seriesStyles).toEqual({ 3: style("red") });
  });

  it("does not let a stale hidden entry hide the WRONG column", () => {
    // Hiding F1 (col 3) then removing it must not leave [3] behind, which
    // would now mean F2 -- a column the user never asked to hide.
    const out = remapViewChannels(view({ hiddenChannels: [3] }), 3);
    expect(out.hiddenChannels).toEqual([]);
  });

  it("shifts plotted channel lists", () => {
    const out = remapViewChannels(view({ yKeys: [3, 4], y2Keys: [4], seriesOrder: [4, 3] }), 3);
    expect(out.yKeys).toEqual([3]);
    expect(out.y2Keys).toEqual([3]);
    expect(out.seriesOrder).toEqual([3]);
  });

  it("nulls xKey when the removed column WAS the x source", () => {
    // No honest substitute exists; null is the store's own "no explicit x".
    expect(remapViewChannels(view({ xKey: 3 }), 3).xKey).toBeNull();
    expect(remapViewChannels(view({ xKey: 4 }), 3).xKey).toBe(3);
    expect(remapViewChannels(view({ xKey: 0 }), 3).xKey).toBe(0);
  });

  it("nulls groupKey/facetKey when the removed column WAS the bound one, shifts otherwise (BUG 2)", () => {
    expect(remapViewChannels(view({ groupKey: 3 }), 3).groupKey).toBeNull();
    expect(remapViewChannels(view({ groupKey: 4 }), 3).groupKey).toBe(3);
    expect(remapViewChannels(view({ groupKey: 0 }), 3).groupKey).toBe(0);
    expect(remapViewChannels(view({ facetKey: 3 }), 3).facetKey).toBeNull();
    expect(remapViewChannels(view({ facetKey: 4 }), 3).facetKey).toBe(3);
    expect(remapViewChannels(view({ facetKey: 0 }), 3).facetKey).toBe(0);
  });

  it("remaps errKeys on BOTH sides (keys are Y channels, values are error channels)", () => {
    expect(remapViewChannels(view({ errKeys: { 4: 5 } }), 3).errKeys).toEqual({ 3: 4 });
    // The error channel itself removed -> the pairing is gone.
    expect(remapViewChannels(view({ errKeys: { 4: 3 } }), 3).errKeys).toEqual({});
    // The Y channel itself removed -> likewise.
    expect(remapViewChannels(view({ errKeys: { 3: 4 } }), 3).errKeys).toEqual({});
  });

  it("leaves a view with nothing above the removed column untouched", () => {
    const v = view({ xKey: 0, yKeys: [1, 2], seriesStyles: { 1: style("blue") } });
    const out = remapViewChannels(v, 5);
    expect(out.xKey).toBe(0);
    expect(out.yKeys).toEqual([1, 2]);
    expect(out.seriesStyles).toEqual({ 1: style("blue") });
  });

  it("preserves nulls (an unset list stays unset, not an empty array)", () => {
    const out = remapViewChannels(view({ yKeys: null, y2Keys: null, seriesOrder: null }), 3);
    expect(out.yKeys).toBeNull();
    expect(out.y2Keys).toBeNull();
    expect(out.seriesOrder).toBeNull();
  });
});

describe("remapWindowViews", () => {
  const win = (id: string, datasetId: string | null, over: Partial<ViewChannelState> = {}) => ({
    id,
    datasetId,
    view: view(over),
  });

  it("remaps only the windows bound to the target dataset", () => {
    const windows = [
      win("a", "d1", { hiddenChannels: [4], seriesStyles: { 4: style("red") } }),
      win("b", "d2", { hiddenChannels: [4] }), // different dataset — untouched
      win("c", null, { hiddenChannels: [4] }), // panel/snapshot (null) — untouched
    ];
    const out = remapWindowViews(windows, "d1", 3);
    expect(out[0].view.hiddenChannels).toEqual([3]); // index 4 shifts down past removed col 3
    expect(out[0].view.seriesStyles).toEqual({ 3: style("red") });
    expect(out[1].view.hiddenChannels).toEqual([4]); // d2 window left alone
    expect(out[1]).toBe(windows[1]); // untouched windows keep identity
    expect(out[2]).toBe(windows[2]);
  });
});

// F2 (SILENT_STATE_CORRUPTION_PLAN): full-chain regression through the real
// `removeFormula` action -- proves the chokepoint fix, not just the pure
// remap function, stops a saved fit's weighting from silently reading a
// different column's numbers.
describe("removeFormula keeps a weighted fit reading its OWN sigma column (F2)", () => {
  beforeEach(() => {
    useApp.setState({
      datasets: [],
      activeId: null,
      recalcMode: "off",
      staleDatasets: [],
      staleFits: [],
      status: "",
    });
  });

  it("a fit weighted by E2 still reads E2's numbers after F1 is removed, not F3's", () => {
    // base [A,B]; formulas F1@2, E2@3 (a computed sigma column), F3@4.
    const formulas: ComputedColumn[] = [
      { name: "F1", expr: "A" },
      { name: "E2", expr: "B" }, // the sigma column the fit is weighted by
      { name: "F3", expr: "A*100" },
    ];
    const data: DataStruct = {
      time: [0, 1, 2],
      values: [
        [1, 5, 1, 5, 100],
        [2, 6, 2, 6, 200],
        [3, 7, 3, 7, 300],
      ],
      labels: ["A", "B", "F1", "E2", "F3"],
      units: ["", "", "", "", ""],
      metadata: {},
    };
    const ds: Dataset = {
      id: "d1",
      name: "d1",
      data,
      formulas,
      fitSpec: { model: "Linear", yKey: 1, weight: { mode: "manual", errKey: 3 } },
    };
    // Before removal the recorded weighting reads E2 = [5,6,7].
    expect(dyForFit(ds, 1, ds.fitSpec!.weight!).dy).toEqual([5, 6, 7]);

    useApp.setState({ datasets: [ds], activeId: "d1", recalcMode: "off" });
    useApp.getState().removeFormula("d1", 0); // delete F1
    const after = useApp.getState().datasets[0];
    expect(after.data.labels).toEqual(["A", "B", "E2", "F3"]);
    // E2 is now channel 2. The recorded weighting must still read [5,6,7];
    // an unremapped errKey=3 would silently read F3 = [100,200,300] instead.
    const sel = fitDataForSpec(after, after.fitSpec!, null, null, null);
    expect(sel?.dy).toEqual([5, 6, 7]);
  });
});
