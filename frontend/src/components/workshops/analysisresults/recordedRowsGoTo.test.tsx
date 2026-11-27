// Go to Source and Reopen in tool on a SAVED ranged result (ROW_RANGE_CONTRACT 3.3, OG20), through the real store and the
// real result panel: a snapshot result (its range in its envelope) and a committed output worksheet (its range in the
// output's private metadata). The recorded rows are selected when the source is as it was; when it changed, nothing is
// selected and the reason is shown; Reopen restores the RECORDED range, never the live one.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => <section aria-label={title}>{children}</section>,
}));
vi.mock("../../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));
vi.mock("../../overlays/ParamDialog", () => ({ askParams: vi.fn() }));

import type { AnalysisResult } from "../../../lib/analysisResult";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { tsRecipe, tsResult, tsSource } from "../../../lib/toolResultKinds.testkit";
import type { Dataset } from "../../../lib/types";
import { useAnalysisExtras } from "../../../store/analysisExtras";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { commitComputedOutput } from "../../../store/commitComputedOutput";
import { useToolResultRequest } from "../../../store/toolResultRequest";
import { useApp } from "../../../store/useApp";
import { STAGE_WORKSHEET_SELECTION_KEY } from "../../../store/worksheetOpen";
import { openWorksheetRowRange } from "../../../store/worksheetAnalysisHandoff";
import AnalysisResultPanel from "./AnalysisResultPanel";

const SHEET: Dataset = {
  id: "d1", name: "run.csv",
  data: { time: [0, 1, 2, 3, 4, 5], values: [[1], [2], [3], [4], [5], [6]], labels: ["v"], units: [""], metadata: {} },
};
const st = () => useApp.getState();
const picked = (): number[] => st().selection?.datasetId === "d1" || st().selection?.datasetId === "log" ? [...st().selection!.rows] : st().worksheetSelections[STAGE_WORKSHEET_SELECTION_KEY]?.rows ?? [];
const GO = /Go to source rows/;

function commit(): AnalysisResult {
  openWorksheetRowRange("d1", [1, 2, 3]);
  expect(commitComputedOutput({
    producer: { id: "tabulate", label: "Tabulate", version: 1 }, sources: [{ id: "d1", computedOn: analysisDataFingerprint(SHEET) }],
    settings: { a: 1 }, name: "out", data: { time: [0], values: [[1]], labels: ["o"], units: [""], metadata: {} },
  })).toMatchObject({ kind: "created" });
  return st().analysisResults[0]!;
}
const open = (id: string) => { useApp.setState({ openAnalysisResultId: id }); render(<AnalysisResultPanel />); };

beforeEach(() => {
  useAnalysisSelection.setState({ toolId: null, selection: null, offeredRanges: {} });
  useAnalysisExtras.setState({ open: [] });
  useToolResultRequest.setState({ timeSeries: null, doe: null, profiler: null });
  useApp.setState({
    datasets: [SHEET], activeId: "d1", analysisResults: [], history: [], future: [], status: "", staleDatasets: [], openAnalysisResultId: null,
    worksheetSelections: {}, stageTab: "plot", worksheetId: null,
  });
});

describe("a committed output that read rows 2-4", () => {
  it("Go to source rows selects exactly the recorded rows in the source worksheet", async () => {
    open(commit().id);
    fireEvent.click(await screen.findByRole("button", { name: GO }));
    await vi.waitFor(() => expect(picked()).toEqual([1, 2, 3]));
    expect(st().worksheetId).toBe("d1");
    expect(st().status).toContain("rows 2-4");
  });

  it("is disabled, with the reason, once the source changed since the save: no stale positions are selected", async () => {
    open(commit().id);
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "d1" ? { ...d, data: { ...d.data, values: [[9], [2], [3], [4], [5], [6]] } } : d)) })));
    const button = await screen.findByRole("button", { name: GO });
    expect(button).toBeDisabled();
    expect(button.getAttribute("title")).toMatch(/has changed since this result was saved/);
    fireEvent.click(button);
    expect(picked()).toEqual([]);
  });

  it("is disabled when rows were inserted (the recorded count no longer lines up)", async () => {
    open(commit().id);
    act(() => st().insertRows("d1", 0, 2));
    expect(await screen.findByRole("button", { name: GO })).toBeDisabled();
  });

  it("an output that read every row has no such button", async () => {
    expect(commitComputedOutput({
      producer: { id: "tabulate", label: "Tabulate", version: 1 }, sources: [{ id: "d1", computedOn: analysisDataFingerprint(SHEET) }],
      settings: { a: 1 }, name: "out", data: { time: [0], values: [[1]], labels: ["o"], units: [""], metadata: {} },
    })).toMatchObject({ kind: "created" });
    open(st().analysisResults[0]!.id);
    await screen.findByText("Source");
    expect(screen.queryByRole("button", { name: GO })).toBeNull();
  });
});

describe("a snapshot result that recorded rows 2-4", () => {
  const ranged = (): AnalysisResult => {
    const base = tsResult();
    return { ...base, parameters: { ...base.parameters, rowRange: { from: 1, to: 3, rows: tsSource.data.time.length } } };
  };

  it("Go to source rows selects the recorded rows of its source", async () => {
    useApp.setState({ datasets: [tsSource], analysisResults: [ranged()] });
    open("ts-1");
    fireEvent.click(await screen.findByRole("button", { name: GO }));
    await vi.waitFor(() => expect(picked()).toEqual([1, 2, 3]));
  });

  it("Reopen in tool restores the RECORDED range (not the live one) once the tool has seeded its selection, and says so", async () => {
    useApp.setState({ datasets: [tsSource], analysisResults: [ranged()] });
    // The live shared selection holds a DIFFERENT window on the same sheet.
    useAnalysisSelection.setState({ toolId: "other", selection: { version: 1, source: "plot", items: [{ datasetId: "log", rowRange: { from: 5, to: 9 } }] } as never });
    open("ts-1");
    fireEvent.click(screen.getByRole("tab", { name: "Result book" }));
    fireEvent.click(await screen.findByRole("button", { name: /Reopen in tool/ }));
    expect(useAnalysisExtras.getState().open).toContain("time-series");
    expect(useToolResultRequest.getState().timeSeries).toEqual(tsRecipe);
    expect(st().status).toMatch(/reopened on the recorded rows 2-4 of “log.dat” \(when saved\), not the live row range/);
    // The tool mounts and seeds its own selection (what useToolAnalysisSelection does): the recorded window lands on it.
    act(() => useAnalysisSelection.setState({ toolId: "time-series", selection: { version: 1, source: "tool-default", items: [{ datasetId: "log" }] } as never }));
    expect(useAnalysisSelection.getState().selection?.items[0]?.rowRange).toEqual({ from: 1, to: 3 });
  });

  it("Reopen in tool is refused, with the reason and nothing opened, when the source changed since the save", async () => {
    const changed = { ...tsSource, data: { ...tsSource.data, values: tsSource.data.values.map((r) => [r[0]! * 2, r[1]!]) } };
    useApp.setState({ datasets: [changed], analysisResults: [ranged()] });
    open("ts-1");
    fireEvent.click(screen.getByRole("tab", { name: "Result book" }));
    fireEvent.click((await screen.findAllByRole("button", { name: /Review and rerun/ }))[0]!);
    expect(useAnalysisExtras.getState().open).toEqual([]);
    expect(st().status).toMatch(/Reopen in tool: .*has changed since this result was saved/);
    expect(st().status).toContain("rows 2-4 of 24");
  });
});
