import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalysisTool } from "../lib/analysisCenter";
import type { Dataset } from "../lib/types";
import { launchAnalysisCenterTool } from "./analysisCenterRun";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";

function dataset(id = "d1"): Dataset {
  return {
    id,
    name: `${id}.csv`,
    data: {
      time: [0, 1, 2],
      values: [[1], [2], [3]],
      labels: ["Signal"],
      units: [""],
      metadata: {},
    },
  };
}

function tool(run = vi.fn()): AnalysisTool {
  return {
    action: { id: "test-tool", group: "Analyze", label: "Test tool…", run },
    category: "Fit",
    requiredInputs: "one numeric response",
    datasetRequired: true,
    available: true,
    recommended: true,
    searchText: "test tool",
  };
}

const realResolveDataset = useApp.getState().resolveDataset;

beforeEach(() => {
  useToasts.setState({ toasts: [] });
  useApp.setState({
    datasets: [],
    activeId: null,
    selectedIds: [],
    stageTab: "analysis",
    status: "",
    resolveDataset: realResolveDataset,
  });
});

describe("Analysis Center launch bridge", () => {
  it("returns to the dataset's plot intent and runs the canonical action exactly once", async () => {
    const source = dataset();
    const selected = tool();
    const beforeRun = vi.fn();
    useApp.setState({ datasets: [source], activeId: source.id });

    await launchAnalysisCenterTool(selected, source.id, beforeRun);

    expect(beforeRun).toHaveBeenCalledOnce();
    expect(selected.action.run).toHaveBeenCalledOnce();
    expect(useApp.getState().stageTab).toBe("plot");
  });

  it("does not launch against a different active worksheet after lazy data resolves", async () => {
    const preview = {
      ...dataset(),
      pending: { kind: "path" as const, path: "C:/project.opju", bookId: "b1", rows: 3000, cols: 1 },
    };
    const full = { ...preview, pending: undefined };
    let finish!: (value: Dataset) => void;
    const resolveDataset = vi.fn(() => new Promise<Dataset>((resolve) => { finish = resolve; }));
    const selected = tool();
    const beforeRun = vi.fn();
    useApp.setState({ datasets: [preview, dataset("d2")], activeId: preview.id, resolveDataset });

    const launch = launchAnalysisCenterTool(selected, preview.id, beforeRun);
    useApp.setState({ activeId: "d2" });
    finish(full);
    await launch;

    expect(beforeRun).not.toHaveBeenCalled();
    expect(selected.action.run).not.toHaveBeenCalled();
    expect(useApp.getState().status).toMatch(/skipped: the active worksheet changed/);
  });

  it("keeps the Center open and never runs an action when full Origin data fails to load", async () => {
    const preview = {
      ...dataset(),
      source: { kind: "path" as const, path: "C:/project.opju" },
      pending: { kind: "path" as const, path: "C:/project.opju", bookId: "b1", rows: 3000, cols: 1 },
    };
    const resolveDataset = vi.fn(async () => { throw new Error("network drive offline"); });
    const selected = tool();
    const beforeRun = vi.fn();
    useApp.setState({ datasets: [preview], activeId: preview.id, resolveDataset });

    await launchAnalysisCenterTool(selected, preview.id, beforeRun);

    expect(beforeRun).not.toHaveBeenCalled();
    expect(selected.action.run).not.toHaveBeenCalled();
    expect(useApp.getState().stageTab).toBe("analysis");
    expect(useApp.getState().status).toContain("network drive offline");
  });
});
