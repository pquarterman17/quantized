// "Open in Baseline" for a Baseline batch output (OPEN_ITEMS row 12, writer 5,
// reopen gaps lane): the batch recorded {method, params, binding} per output, the
// same record a single Baseline subtract makes, so it reopens in the Baseline tool
// on the recorded source. FAIL CLOSED: a channel that is no longer at its recorded
// place (by position AND name) or an incomplete record opens the tool WITHOUT
// settings, with the reason, and Replace off.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { planReopen } from "../../../lib/committedOutputReopen";
import type { DataStruct } from "../../../lib/types";
import { useToolReopen } from "../../../store/toolReopen";
import { openCommittedResultInTool } from "../../../store/toolReopenOpen";
import { useApp } from "../../../store/useApp";
import { commitBaselineBatch, subtractBaselineData } from "../baseline/baselineBatch";
import { useBaseline } from "../baseline/useBaseline";

const sheet = (labels: string[]): DataStruct => ({
  time: [0, 1, 2, 3], values: [[1, 5], [2, 6], [3, 7], [4, 8]], labels, units: ["", ""], metadata: { x_column_name: "x" },
});
const PARAMS = {
  lam: 1e6, p: 0.01, radius: 100, order: 5, maxWindowDeg: 7, regionXMin: Number.NaN, regionXMax: Number.NaN,
  regionYMin: Number.NaN, regionYMax: Number.NaN, maxIter: 50, anchorMethod: "pchip",
};

function reset(second = ["a", "b"]): void {
  useToolReopen.setState({ sessions: {} });
  useApp.setState({
    datasets: [{ id: "s1", name: "one", data: sheet(["a", "b"]) }, { id: "s2", name: "two", data: sheet(second) }],
    activeId: "s1", selectedIds: ["s1", "s2"], status: "", analysisResults: [], history: [], future: [], staleDatasets: [],
    staleFits: [], recalcMode: "manual", baselineOpen: false, xKey: null, yKeys: [0], stageTab: "worksheet",
  });
}

function commitBatch(): void {
  const { datasets } = useApp.getState();
  const items = datasets.map((ds) => {
    const binding = { datasetId: ds.id, xKey: null, yKey: 1, xLabel: "x", yLabel: "b" };
    return {
      name: `${ds.name} (bg-sub)`, data: subtractBaselineData(ds.data, [0, 0, 0, 0], binding, "snip"), sourceId: ds.id,
      computedOn: analysisDataFingerprint(ds), settings: { method: "snip", params: PARAMS, binding }, xKey: null,
    };
  });
  const out = commitBaselineBatch(items, datasets, "snip", useApp.getState);
  expect(out.refused).toEqual([]);
  expect(out.ids).toHaveLength(2);
}

const resultFor = (sourceId: string) =>
  useApp.getState().analysisResults.find((r) => r.producer.id === "baseline-batch" && r.sources[0]?.datasetId === sourceId)!;
const open = (sourceId: string): boolean => { let ok = false; act(() => { ok = openCommittedResultInTool(resultFor(sourceId).id); }); return ok; };

beforeEach(() => { reset(); });

describe("Baseline batch reopens in Baseline", () => {
  it("the plan names Baseline and runs the session under the Baseline tool id", () => {
    commitBatch();
    const plan = planReopen(resultFor("s2"), useApp.getState().datasets);
    expect(plan).toMatchObject({ ok: true, label: "Open in Baseline", tool: "baseline-subtract", resultProducer: "baseline-batch", sourceId: "s2" });
  });

  it("restores the method, its knobs and the plotted channel on the recorded source", () => {
    commitBatch();
    expect(open("s2")).toBe(true);
    expect(useApp.getState()).toMatchObject({ baselineOpen: true, activeId: "s2", yKeys: [1], stageTab: "plot" });
    expect(useToolReopen.getState().sessions["baseline-subtract"]).toMatchObject({ sourceId: "s2", mode: "replace", replaceBlocked: null });
    const { result } = renderHook(() => useBaseline());
    expect(result.current.method).toBe("snip");
    expect(result.current.params.maxWindowDeg).toBe(7);
    expect(result.current.params.regionXMin).toBeNaN();
  });

  it("a changed channel is NOT guessed: no settings, the reason, Replace off", () => {
    commitBatch();
    reset(["a", "renamed"]);
    commitBatch(); // fresh results, then rename the channel at the recorded position
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "s2" ? { ...d, data: { ...d.data, labels: ["a", "renamed"] } } : d)) }));
    expect(open("s2")).toBe(true);
    const session = useToolReopen.getState().sessions["baseline-subtract"]!;
    expect(session.seed).toBeNull();
    expect(session.replaceBlocked).toContain("“b” is no longer at its place");
    expect(session.mode).toBe("new");
    const { result } = renderHook(() => useBaseline());
    expect(result.current.method).not.toBe("snip");
  });

  it("an incomplete record (no binding) is not seeded", () => {
    commitBatch();
    const r = resultFor("s1");
    const settings = { ...(r.parameters!["settings"] as Record<string, unknown>) };
    delete settings["binding"];
    useApp.setState((s) => ({ analysisResults: s.analysisResults.map((x) => (x.id === r.id ? { ...x, parameters: { ...x.parameters, settings } as typeof x.parameters } : x)) }));
    expect(open("s1")).toBe(true);
    const session = useToolReopen.getState().sessions["baseline-subtract"]!;
    expect(session.seed).toBeNull();
    expect(session.replaceBlocked).toContain("not recorded completely");
  });
});
