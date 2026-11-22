// Lane RO2: a reopen session must not outlive its tool (IR suspected item 4),
// and Replace must not look like it replaced when another result already holds
// the computation (IR suspected item 3, the button side).

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import type { DataStruct } from "../../../lib/types";
import { useAnalysisExtras } from "../../../store/analysisExtras";
import { commitAnalysisOutput, type AnalysisOutputCommit } from "../../../store/analysisOutputCommit";
import { useToolReopen } from "../../../store/toolReopen";
import { openCommittedResultInTool } from "../../../store/toolReopenOpen";
import { useApp } from "../../../store/useApp";
import { useAnalysisCommit } from "./useAnalysisCommit";
import { useReopenSeed } from "./useReopenSession";

const data = (values: number[]): DataStruct => ({
  time: values.map((_, i) => i), values: values.map((v) => [v]), labels: ["y"], units: [""], metadata: {},
});
const SRC = { id: "src", name: "Film", data: data([1, 2, 3]) };

function request(tool: string, settings: Record<string, unknown>, fill: number): AnalysisOutputCommit {
  return {
    producer: { id: tool, label: tool, version: 1 }, sourceId: "src", computedOn: analysisDataFingerprint(SRC), settings,
    output: () => ({ name: `out ${fill}`, data: data([fill, fill, fill]) }),
  };
}

const resultOf = (tool: string) => useApp.getState().analysisResults.find((r) => r.producer.id === tool)!.id;

beforeEach(() => {
  useToolReopen.setState({ sessions: {} });
  useAnalysisExtras.setState({ open: [] });
  useApp.setState({
    datasets: [SRC], activeId: "src", analysisResults: [], history: [], future: [], staleDatasets: [], staleFits: [],
    recalcMode: "manual", status: "", baselineOpen: false, tabulateOpen: false,
  });
});

describe("a reopen session ends when its tool is closed, even if the panel never mounted", () => {
  it("Tabulate: closing the tool (its panel chunk never loaded) drops the old seed for the next manual open", () => {
    commitAnalysisOutput(request("tabulate", { groupCols: [0], valueCols: [0] }, 1));
    act(() => { openCommittedResultInTool(resultOf("tabulate")); });
    expect(useApp.getState().tabulateOpen).toBe(true);
    // The panel never mounted (no render): nothing will ever unmount and end the session.
    expect(useToolReopen.getState().sessions["tabulate"]).toBeDefined();
    act(() => useApp.getState().setTabulateOpen(false)); // the user dismisses the failed panel
    expect(useToolReopen.getState().sessions["tabulate"]).toBeUndefined();
    act(() => useApp.getState().setTabulateOpen(true)); // ...and opens the tool normally
    const { result } = renderHook(() => useReopenSeed("tabulate", "src"));
    expect(result.current).toBeNull();
  });

  it("an analysis-extras tool (Ellipse fit) too", () => {
    commitAnalysisOutput(request("ellipse-fit", { geometric: true }, 1));
    act(() => { openCommittedResultInTool(resultOf("ellipse-fit")); });
    expect(useAnalysisExtras.getState().open).toContain("ellipse-fit");
    act(() => useAnalysisExtras.getState().hide("ellipse-fit"));
    expect(useToolReopen.getState().sessions["ellipse-fit"]).toBeUndefined();
    act(() => useAnalysisExtras.getState().show("ellipse-fit"));
    expect(renderHook(() => useReopenSeed("ellipse-fit", "src")).result.current).toBeNull();
  });

  it("the session survives unrelated store updates while the tool stays open", () => {
    commitAnalysisOutput(request("tabulate", { groupCols: [0], valueCols: [0] }, 1));
    act(() => { openCommittedResultInTool(resultOf("tabulate")); });
    act(() => useApp.getState().setStatus("something else"));
    expect(useToolReopen.getState().sessions["tabulate"]).toBeDefined();
    expect(renderHook(() => useReopenSeed("tabulate", "src")).result.current?.settings).toMatchObject({ groupCols: [0] });
  });

  it("a second Open in the same tool replaces the session, and the old watch does not end the new one", () => {
    commitAnalysisOutput(request("tabulate", { groupCols: [0], valueCols: [0] }, 1));
    act(() => { openCommittedResultInTool(resultOf("tabulate")); });
    const first = useToolReopen.getState().sessions["tabulate"]!.nonce;
    act(() => { openCommittedResultInTool(resultOf("tabulate")); });
    expect(useToolReopen.getState().sessions["tabulate"]!.nonce).toBeGreaterThan(first);
    act(() => useApp.getState().setStatus("x"));
    expect(useToolReopen.getState().sessions["tabulate"]).toBeDefined();
    act(() => useApp.getState().setTabulateOpen(false));
    expect(useToolReopen.getState().sessions["tabulate"]).toBeUndefined();
  });
});

describe("the commit button says why when Replace would duplicate another result", () => {
  it("Replace chosen + another current result holds the computation: disabled with the Replace reason", () => {
    commitAnalysisOutput(request("tabulate", { groupCols: [0], valueCols: [0] }, 1)); // R1
    commitAnalysisOutput(request("tabulate", { groupCols: [0], valueCols: [1] }, 7)); // R2 (Add as new)
    const r1 = useApp.getState().analysisResults[0]!.id;
    act(() => { openCommittedResultInTool(r1); });
    expect(useToolReopen.getState().sessions["tabulate"]!.mode).toBe("replace");
    const { result } = renderHook(() => useAnalysisCommit(request("tabulate", { groupCols: [0], valueCols: [1] }, 7)));
    expect(result.current.disabledReason).toContain("already holds this exact computation");
    expect(result.current.disabledReason).toContain("Replace would leave two identical outputs");
    // In Add as new mode the original wording stays.
    act(() => useToolReopen.getState().setMode("tabulate", "new"));
    expect(result.current.disabledReason).toMatch(/^Already added as “out 7”/);
  });
});
