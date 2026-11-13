// Follow-up 2: a Y hidden because it belongs to a LATER X column could be
// toggled on from the legend and was then drawn against the FIRST X -- the
// wrong plot. Un-hiding it now opens the per-series-X plot instead; "show
// all" and solo never un-hide it either.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../lib/types";
import { useApp } from "./useApp";

// The per-series-X plot for this (generic-technique) book is the Quick Figure
// Builder, which the store records as `quickFigureBuilderDatasetId`.
const opened = () => useApp.getState().quickFigureBuilderDatasetId;

// X(A) Signal(Y) X2(X) Signal2(Y): Signal2 belongs to X2.
const book: Dataset = {
  id: "b",
  name: "desig.opj",
  data: {
    time: [0, 1],
    values: [
      [1, 10, 2],
      [2, 20, 3],
    ],
    labels: ["Signal", "X2", "Signal2"],
    units: ["", "", ""],
    metadata: { origin_column_names: ["B", "C", "D"], column_designations: { A: "X", B: "Y", C: "X", D: "Y" } },
  },
};

beforeEach(() => {
  useApp.setState({
    datasets: [book], activeId: "b", xKey: null, yKeys: null, hiddenChannels: [1, 2], status: "",
    quickFigureBuilderDatasetId: null,
  });
});

describe("a Y on its own X is never drawn against the plot's X", () => {
  it("un-hiding it from the legend opens the per-series-X plot instead", async () => {
    useApp.getState().toggleHidden(2);
    expect(useApp.getState().hiddenChannels).toEqual([1, 2]); // still held back
    expect(useApp.getState().status).toBe(
      '"Signal2" belongs to the X column "X2", not this plot\'s X — plotting each Y against its own X instead',
    );
    await vi.waitFor(() => expect(opened()).toBe("b"));
  });

  it("an ordinary curve still toggles both ways", async () => {
    useApp.getState().toggleHidden(0);
    expect(useApp.getState().hiddenChannels).toEqual([1, 2, 0]);
    useApp.getState().toggleHidden(0);
    expect(useApp.getState().hiddenChannels).toEqual([1, 2]);
    await new Promise((r) => setTimeout(r, 50));
    expect(opened()).toBeNull();
  });

  it("show-all and solo do not un-hide it either", () => {
    useApp.getState().soloChannel(null);
    expect(useApp.getState().hiddenChannels).toEqual([2]); // X2 itself is shown-able; Signal2 stays held
    useApp.setState({ hiddenChannels: [1] });
    useApp.getState().soloChannel(2);
    expect(useApp.getState().hiddenChannels).toEqual([1]);
    expect(useApp.getState().status).toContain('"Signal2" belongs to the X column "X2"');
  });

  it("is drawable once the plot's X IS its own X column", () => {
    useApp.setState({ xKey: 1 });
    useApp.getState().toggleHidden(2);
    expect(useApp.getState().hiddenChannels).toEqual([1]);
  });

  it("can still be hidden when it is somehow shown", () => {
    useApp.setState({ hiddenChannels: [1] });
    useApp.getState().toggleHidden(2);
    expect(useApp.getState().hiddenChannels).toEqual([1, 2]);
  });
});
