// A saved result that read a NAMED range goes out of date when the range moves (ROW_RANGE_CONTRACT 5.2), through the real
// store and the real result panel: a retarget changes no data, so the source fingerprint cannot see it. Reopen in tool then
// re-runs on the range's CURRENT rows, following it. Undo of the retarget makes the result current again.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => <section aria-label={title}>{children}</section>,
}));
vi.mock("../../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));
vi.mock("../../overlays/ParamDialog", () => ({ askParams: vi.fn() }));

import type { AnalysisResult } from "../../../lib/analysisResult";
import { snapshotResultState } from "../../../lib/analysisResultFreshness";
import { tsResult, tsSource } from "../../../lib/toolResultKinds.testkit";
import { useAnalysisExtras } from "../../../store/analysisExtras";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { defineNamedRange, removeNamedRange, retargetNamedRange } from "../../../store/namedRanges";
import { resetRangeLinkSyncForTests } from "../../../store/rangeLinkSync";
import { useToolResultRequest } from "../../../store/toolResultRequest";
import { useApp } from "../../../store/useApp";
import AnalysisResultPanel from "./AnalysisResultPanel";

const st = () => useApp.getState();
const N = tsSource.data.time.length;
let rangeId = "";

/** The time-series result with the range it read recorded as the save records it: rows 2-4, the name and the id. */
const ranged = (): AnalysisResult => {
  const base = tsResult();
  return { ...base, parameters: { ...base.parameters, rowRange: { from: 1, to: 3, rows: N, name: "Base", rangeId } } };
};
const openPanel = () => { useApp.setState({ openAnalysisResultId: "ts-1" }); render(<AnalysisResultPanel />); };
const retarget = (rows: { from: number; to: number } | null) => act(() => { expect(retargetNamedRange(rangeId, { datasetId: "log", cols: [0], rows })).toMatchObject({ ok: true }); });

beforeEach(() => {
  resetRangeLinkSyncForTests();
  useAnalysisSelection.setState({ toolId: null, selection: null, offeredRanges: {} });
  useAnalysisExtras.setState({ open: [] });
  useToolResultRequest.setState({ timeSeries: null, doe: null, profiler: null });
  useApp.setState({ datasets: [tsSource], workbooks: [], activeId: "log", namedRanges: [], analysisResults: [], history: [], future: [], status: "", staleDatasets: [], openAnalysisResultId: null });
  const made = defineNamedRange({ name: "Base", scope: "sheet", datasetId: "log", cols: [0], rows: { from: 1, to: 3 } });
  rangeId = made.ok ? made.id : "";
  useApp.setState({ analysisResults: [ranged()] });
});

describe("a result that read named range Base (rows 2-4)", () => {
  it("is current while the range is as it was", async () => {
    openPanel();
    expect(await screen.findByText("Current")).toBeTruthy();
    expect(snapshotResultState(st().analysisResults[0]!, st().datasets)).toBe("current");
  });

  it("goes out of date when the range is retargeted, says which range and what moved, and does not claim the DATA changed", async () => {
    openPanel();
    await screen.findByText("Current");
    retarget({ from: 2, to: 5 });
    expect(await screen.findByText("Out of date")).toBeTruthy();
    expect(screen.getByText("Out of date: range Base changed since this result was saved (it read rows 2-4; now rows 3-6). Reopen in tool to run it on the range's current rows.")).toBeTruthy();
    expect(screen.queryByText(/source data changed/)).toBeNull();
    expect(snapshotResultState(st().analysisResults[0]!, st().datasets)).toBe("out-of-date");
  });

  it("is current again after Undo of the retarget (one step), and a range moved back by hand is current too", async () => {
    openPanel();
    retarget({ from: 2, to: 5 });
    await screen.findByText("Out of date");
    act(() => st().undo());
    expect(await screen.findByText("Current")).toBeTruthy();
    retarget({ from: 4, to: 6 });
    await screen.findByText("Out of date");
    retarget({ from: 1, to: 3 });
    expect(await screen.findByText("Current")).toBeTruthy();
  });

  it("a range with no row limit now (every row) is a change too, said in words", async () => {
    openPanel();
    retarget(null);
    expect(await screen.findByText(/it read rows 2-4; now all 24 rows/)).toBeTruthy();
  });

  it("a deleted range is NOT a change: nothing it read moved, and the record still says what was read", async () => {
    openPanel();
    await screen.findByText("Current");
    act(() => { removeNamedRange(rangeId, { confirmed: true }); });
    expect(st().namedRanges).toHaveLength(0);
    expect(snapshotResultState(st().analysisResults[0]!, st().datasets)).toBe("current");
  });

  it("a result saved before the id was recorded is never judged by NAME: a later range called Base changes nothing", async () => {
    const old = ranged();
    useApp.setState({ analysisResults: [{ ...old, parameters: { ...old.parameters, rowRange: { from: 1, to: 3, rows: N, name: "Base" } } }] });
    retarget({ from: 2, to: 5 });
    expect(snapshotResultState(st().analysisResults[0]!, st().datasets)).toBe("current");
  });

  it("Reopen in tool re-runs on the range's CURRENT rows and follows it from then on (not the recorded rows)", async () => {
    openPanel();
    retarget({ from: 2, to: 5 });
    await screen.findByText("Out of date");
    fireEvent.click(screen.getByRole("tab", { name: "Result book" }));
    fireEvent.click((await screen.findAllByRole("button", { name: /Reopen in tool|Review and rerun/ }))[0]!);
    expect(useAnalysisExtras.getState().open).toContain("time-series");
    expect(st().status).toMatch(/reopened on named range Base \(rows 3-6 of “log.dat”\), its current rows/);
    // The tool mounts and seeds its own selection: the window that lands on it is the live link, not rows 2-4.
    act(() => useAnalysisSelection.setState({ toolId: "time-series", selection: { version: 1, source: "tool-default", items: [{ datasetId: "log" }] } as never }));
    expect(useAnalysisSelection.getState().selection?.items[0]?.rowRange).toMatchObject({ from: 2, to: 5, named: rangeId, namedAs: "Base" });
    retarget({ from: 6, to: 9 });
    expect(useAnalysisSelection.getState().selection?.items[0]?.rowRange).toMatchObject({ from: 6, to: 9, named: rangeId });
  });

  it("Reopen in tool stays refused when the range cannot be read now (its sheet was replaced), saying why", async () => {
    openPanel();
    retarget({ from: 2, to: 5 });
    act(() => useApp.setState((s) => ({ namedRanges: s.namedRanges.map((r) => ({ ...r, rowsStale: true as const })) })));
    await screen.findByText("Out of date");
    fireEvent.click(screen.getByRole("tab", { name: "Result book" }));
    fireEvent.click((await screen.findAllByRole("button", { name: /Reopen in tool|Review and rerun/ }))[0]!);
    expect(useAnalysisExtras.getState().open).toEqual([]);
    expect(st().status).toMatch(/Reopen in tool: .*changed since this result was saved/);
  });
});
