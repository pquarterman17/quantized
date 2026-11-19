// Multi-output Freeze: explicit chooser, one undo step, source untouched,
// fail-closed on a mid-choice change, double-click guard, single-output path.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { AnalysisResult } from "../../../lib/analysisResult";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import AnalysisResultFreeze from "./AnalysisResultFreeze";

const mk = (id: string, v: number, derived = true): Dataset => ({
  id, name: `Out ${id}`,
  data: { time: [0, 1], values: [[v], [v + 1]], labels: ["Y"], units: [""], metadata: {} },
  ...(derived ? { derivedFrom: { datasetId: "src", pipeline: "P" } } : {}),
});
const base: AnalysisResult = {
  version: 1, id: "r", name: "Fit", producer: { id: "signal-processing", label: "S", version: 1 },
  sources: [{ datasetId: "src", role: "input" }],
  outputs: [{ datasetId: "a", role: "linked-worksheet" }, { datasetId: "b", role: "linked-worksheet" }, { datasetId: "c", role: "linked-worksheet" }],
  warnings: [], createdAt: "2026-01-01",
};
const names = () => useApp.getState().datasets.map((d) => d.name);

function Host() {
  const result = useApp((s) => s.analysisResults[0]);
  return <AnalysisResultFreeze result={result} busy={null} setBusy={() => {}} onFrozen={() => {}} />;
}

beforeEach(() => {
  useApp.setState({
    datasets: [{ id: "src", name: "Src", data: mk("src", 0, false).data }, mk("a", 1), mk("b", 2), mk("c", 3)],
    analysisResults: [base], activeId: "src", history: [], future: [], staleDatasets: [], status: "",
  });
});

describe("AnalysisResultFreeze chooser", () => {
  it("starts with nothing selected; freezing 2 of 3 makes 2 worksheets in one undo step and leaves the source alone", async () => {
    const before = useApp.getState();
    const resultBefore = before.analysisResults[0];
    const outBefore = before.datasets.filter((d) => ["a", "b", "c"].includes(d.id));
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Freeze…" }));
    expect(screen.getAllByText(/Linked worksheet · 2 × 1/)).toHaveLength(3);
    expect(screen.getByRole("button", { name: /Freeze selected \(0\)/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Out a" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Out c" }));
    fireEvent.click(screen.getByRole("button", { name: /Freeze selected \(2\)/ }));
    await waitFor(() => expect(names()).toHaveLength(6));
    expect(names().slice(4)).toEqual(["Fit — Out a (frozen)", "Fit — Out c (frozen)"]);
    expect(useApp.getState().datasets.slice(4).every((d) => !d.derivedFrom)).toBe(true);
    expect(useApp.getState().analysisResults[0]).toBe(resultBefore);
    expect(useApp.getState().datasets.filter((d) => ["a", "b", "c"].includes(d.id))).toEqual(outBefore);
    act(() => useApp.getState().undo());
    expect(names()).toEqual(["Src", "Out a", "Out b", "Out c"]);
    expect(useApp.getState().datasets.filter((d) => ["a", "b", "c"].includes(d.id))).toEqual(outBefore);
    expect(useApp.getState().analysisResults[0]).toEqual(resultBefore);
    act(() => useApp.getState().redo());
    expect(names().slice(4)).toEqual(["Fit — Out a (frozen)", "Fit — Out c (frozen)"]);
    expect(useApp.getState().datasets.filter((d) => ["a", "b", "c"].includes(d.id))).toEqual(outBefore);
  });

  it("refuses everything when a chosen output changed after it was ticked", async () => {
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Freeze…" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Out a" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Out b" }));
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => d.id === "b" ? { ...d, data: mk("b", 99).data } : d) })));
    fireEvent.click(screen.getByRole("button", { name: /Freeze selected \(2\)/ }));
    await waitFor(() => expect(useApp.getState().status).toMatch(/changed while choosing/));
    expect(names()).toEqual(["Src", "Out a", "Out b", "Out c"]);
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("a double click creates the worksheet once", async () => {
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Freeze…" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Out a" }));
    const go = screen.getByRole("button", { name: /Freeze selected \(1\)/ });
    fireEvent.click(go);
    fireEvent.click(go);
    await waitFor(() => expect(names()).toHaveLength(5));
    await new Promise((r) => setTimeout(r, 30));
    expect(names().filter((n) => n.endsWith("(frozen)"))).toHaveLength(1);
  });

  it("freezes a saved numeric result table into a worksheet and converts text columns to categorical, refusing only mixed columns", async () => {
    useApp.setState({
      analysisResults: [{ ...base, producer: { id: "statistical-test", label: "T", version: 1 }, outputs: [],
        tables: [{ title: "Params", columns: ["a", "b"], rows: [[1, 2], [3, null]] }, { title: "Words", columns: ["n", "v"], rows: [["x", 1], ["y", 2]] }, { title: "Mixed", columns: ["n"], rows: [["x"], [1]] }] }],
    });
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Freeze…" }));
    expect(screen.getByRole("checkbox", { name: "Mixed" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Words" })).toBeEnabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Params" }));
    fireEvent.click(screen.getByRole("button", { name: /Freeze selected \(1\)/ }));
    await waitFor(() => expect(names()).toContain("Fit — Params (frozen)"));
    const sheet = useApp.getState().datasets.at(-1)!;
    expect(sheet.data.labels).toEqual(["a", "b"]);
    expect(sheet.data.values[1][0]).toBe(3);
    expect(Number.isNaN(sheet.data.values[1][1])).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Freeze…" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Words" }));
    fireEvent.click(screen.getByRole("button", { name: /Freeze selected \(1\)/ }));
    await waitFor(() => expect(names()).toContain("Fit — Words (frozen)"));
    expect(useApp.getState().datasets.at(-1)!.data.cat_levels).toEqual({ 0: ["x", "y"] });
  });
});

describe("single-output and unavailable", () => {
  it("one linked output keeps the one-click Freeze data with the classic name", async () => {
    useApp.setState({ analysisResults: [{ ...base, outputs: [base.outputs[0]] }] });
    render(<Host />);
    expect(screen.queryByRole("button", { name: "Freeze…" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Freeze data" }));
    await waitFor(() => expect(names()).toContain("Out a (frozen)"));
  });
  it("a producer with no outputs shows an unavailable, disabled Freeze", () => {
    useApp.setState({ analysisResults: [{ ...base, producer: { id: "peak-analysis", label: "P", version: 1 }, outputs: [] }] });
    render(<Host />);
    expect(screen.getByRole("button", { name: "Freeze data" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Freeze data" })).toHaveAttribute("title", "Freeze isn't available for this result.");
  });
});
