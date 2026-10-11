import { describe, expect, it } from "vitest";

import type { Action } from "../store/commands";
import { buildAnalysisCommands } from "../commands/analysisCommands";
import { ANALYSIS_TOOL_METADATA, analysisTools, matchesAnalysisSearch } from "./analysisCenter";
import type { Dataset } from "./types";

const action = (id: string, label = id): Action => ({ id, group: "Analyze", label, description: `${label} purpose`, run: () => {} });

function dataset(technique = "generic", labels = ["Signal", "Group", "Batch"]): Dataset {
  return {
    id: "d1",
    name: "sample.dat",
    data: {
      time: Array.from({ length: 12 }, (_, index) => index),
      values: Array.from({ length: 12 }, (_, index) => [index * 1.5, index % 2, index % 3]),
      labels,
      units: labels.map(() => ""),
      metadata: { technique },
    },
  };
}

describe("analysisTools", () => {
  it("documents every canonical Analyze command instead of maintaining a partial shadow catalog", () => {
    const ids = buildAnalysisCommands(() => ({} as never))
      .filter((entry) => entry.group === "Analyze" && entry.id !== "analysis-center")
      .map((entry) => entry.id);
    expect(ids.filter((id) => !(id in ANALYSIS_TOOL_METADATA))).toEqual([]);
    expect(Object.keys(ANALYSIS_TOOL_METADATA).filter((id) => !ids.includes(id))).toEqual([]);
  });

  it("keeps data-independent tools available and explains unavailable dataset tools", () => {
    const tools = analysisTools([action("calculators"), action("curvefit")], undefined);
    expect(tools.find((tool) => tool.action.id === "calculators")).toMatchObject({ available: true, datasetRequired: false });
    expect(tools.find((tool) => tool.action.id === "curvefit")).toMatchObject({ available: false, unavailableReason: "Select a worksheet first." });
  });

  it("recommends from declared technique without exposing incompatible specialist tools", () => {
    const tools = analysisTools([action("sims"), action("hysteresis"), action("curvefit")], dataset("sims"));
    expect(tools.find((tool) => tool.action.id === "sims")).toMatchObject({ available: true, recommended: true });
    expect(tools.find((tool) => tool.action.id === "hysteresis")).toMatchObject({ available: false, recommended: false });
    expect(tools.find((tool) => tool.action.id === "curvefit")).toMatchObject({ available: true, recommended: false });
  });

  it("uses modeling types to guard multivariate and nested variability inputs", () => {
    const oneNumeric = dataset("generic", ["Signal"]);
    oneNumeric.data.values = oneNumeric.data.values.map((row) => [row[0]]);
    const tools = analysisTools([action("multivar"), action("variability-chart")], oneNumeric);
    expect(tools[0]).toMatchObject({ available: false, unavailableReason: "At least two numeric columns are required." });
    expect(tools[1]).toMatchObject({ available: false });
  });

  it("respects the canonical command's dynamic disabled state and explanation", () => {
    const [tool] = analysisTools([{
      ...action("curvefit"),
      disabled: () => true,
      disabledReason: () => "Finish the current fit first.",
    }], dataset());
    expect(tool).toMatchObject({ available: false, recommended: false, unavailableReason: "Finish the current fit first." });
  });

  it("searches command prose, requirements, and categories by every query term", () => {
    const [tool] = analysisTools([{ ...action("curvefit", "Curve fit"), keywords: "regression nonlinear" }], dataset());
    expect(matchesAnalysisSearch(tool, "nonlinear numeric")).toBe(true);
    expect(matchesAnalysisSearch(tool, "nonlinear map")).toBe(false);
  });
});
