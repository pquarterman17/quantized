import { describe, expect, it } from "vitest";

import { buildAnalysisCommands } from "../../../commands/analysisCommands";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import {
  DEFAULT_SIGNAL_SETTINGS,
  channelsWithoutFiniteValues,
  measuredChannels,
  selectedBoundErrorTargets,
  settingsToParams,
} from "./signalProcessingModel";

const dataset: Dataset = {
  id: "d",
  name: "sample",
  data: {
    time: [1, 2],
    values: [[10, 1, 0], [20, 2, 1]],
    labels: ["signal", "sigma", "group"],
    units: ["V", "V", ""],
    metadata: {},
    cat_levels: { 2: ["a", "b"] },
  },
  errorRoles: [{ channel: 1, target: 0, axis: "y", side: "both" }],
};

describe("signal processing model", () => {
  it("opens from the canonical Analyze command", () => {
    useApp.setState({ signalProcessingOpen: false });
    buildAnalysisCommands(useApp.getState).find((action) => action.id === "signal-processing")?.run();
    expect(useApp.getState().signalProcessingOpen).toBe(true);
  });

  it("offers measured channels but excludes categorical and error columns", () => {
    expect(measuredChannels(dataset)).toEqual([0]);
  });

  it("builds a channel-targeted smoothing recipe", () => {
    expect(settingsToParams(DEFAULT_SIGNAL_SETTINGS, [0])).toEqual({
      signalChannels: [0],
      smoothEnabled: true,
      smoothMethod: "savitzky-golay",
      smoothWindow: 5,
    });
  });

  it("builds every non-smoothing recipe with the selected channels", () => {
    expect(settingsToParams({ ...DEFAULT_SIGNAL_SETTINGS, operation: "normalize-area" }, [2, 4])).toEqual({
      signalChannels: [2, 4],
      normMethod: "Area (integral=1)",
    });
    expect(settingsToParams({ ...DEFAULT_SIGNAL_SETTINGS, operation: "derivative-second" }, [3])).toEqual({
      signalChannels: [3],
      derivativeMode: "d²Y/dX²",
    });
  });

  it("reports only selected targets with bound Y uncertainty", () => {
    expect(selectedBoundErrorTargets(dataset, [0])).toEqual([0]);
    expect(selectedBoundErrorTargets(dataset, [])).toEqual([]);
  });

  it("identifies selected outputs that contain no finite values", () => {
    const data = { ...dataset.data, values: [[1, Number.NaN, 0], [2, Number.NaN, 1]] };
    expect(channelsWithoutFiniteValues(data, [0, 1])).toEqual([1]);
  });
});
