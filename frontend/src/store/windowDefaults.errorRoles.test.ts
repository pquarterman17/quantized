// Audit #18: a CSV whose header names an error column ("t, signal, err")
// gets it as signal's Y error AND used to draw it as a Y curve of its own.
// An error-role column now feeds the whiskers and is hidden as a curve on
// every rebind — import included — like Origin and like Quick Plot.

import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../lib/types";
import { seedErrorRoles } from "./importErrorRoles";
import { useApp } from "./useApp";
import { datasetViewDefaults } from "./windowDefaults";

const data = {
  time: [0, 1, 2],
  values: [[3, 0.1], [2, 0.1], [1, 0.1]],
  labels: ["signal", "err"],
  units: ["", ""],
  metadata: {},
};
const DS: Dataset = { id: "e1", name: "decay_err.csv", data, ...seedErrorRoles(data) };

beforeEach(() => {
  useApp.setState({ datasets: [], activeId: null, hiddenChannels: [], errKeys: {} });
});

describe("error-role columns are not default-plotted as Y", () => {
  it("the import seed pairs err with signal", () => {
    expect(DS.errorRoles).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]);
  });

  it("view defaults hide the error column and bind it as signal's whiskers", () => {
    const v = datasetViewDefaults(DS);
    expect(v.hiddenChannels).toEqual([1]);
    expect(v.errKeys).toEqual({ 0: 1 });
  });

  it("an import (addDataset) shows signal with error bars, not err as a curve", () => {
    useApp.getState().addDataset(DS);
    expect(useApp.getState().hiddenChannels).toEqual([1]);
    expect(useApp.getState().errKeys).toEqual({ 0: 1 });
  });

  it("a deliberate 'no error columns' answer hides nothing", () => {
    const v = datasetViewDefaults({ ...DS, errorRoles: [] });
    expect(v.hiddenChannels).toEqual([]);
  });
});
