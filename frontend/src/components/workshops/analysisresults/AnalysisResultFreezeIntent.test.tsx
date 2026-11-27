// Freeze is a passive action: it creates worksheets and says so, and never
// moves the user's context (active dataset, selection, focused plot, tab). Only
// the explicit "Open as worksheet" gesture navigates (store/worksheetOpen.ts).
// Driven through the real result workspace, not the Freeze component alone.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalysisResult } from "../../../lib/analysisResult";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import AnalysisResultPanel from "./AnalysisResultPanel";

vi.mock("../../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));
vi.mock("../../overlays/ParamDialog", () => ({ askParams: vi.fn() }));
vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => <section aria-label={title}>{children}</section>,
}));

const mk = (id: string, v: number, derived = true): Dataset => ({
  id, name: `Out ${id}`,
  data: { time: [0, 1], values: [[v], [v + 1]], labels: ["Y"], units: [""], metadata: {} },
  ...(derived ? { derivedFrom: { datasetId: "src", pipeline: "P" } } : {}),
});
const result = (outputs: string[]): AnalysisResult => ({
  version: 1, id: "r", name: "Fit", producer: { id: "signal-processing", label: "S", version: 1 },
  sources: [{ datasetId: "src", role: "input" }],
  selection: { datasetId: "src", channels: [{ index: 0, label: "Y", unit: "" }] },
  outputs: outputs.map((datasetId) => ({ datasetId, role: "linked-worksheet" as const })),
  tableRefs: outputs.map((datasetId) => ({ datasetId, label: `Out ${datasetId}` })),
  warnings: [], createdAt: "2026-01-01",
});

function seed(outputs: string[]): void {
  useApp.setState({
    datasets: [{ ...mk("src", 0, false), name: "Src" }, ...outputs.map((id) => mk(id, 1))],
    analysisResults: [result(outputs)], openAnalysisResultId: "r",
    activeId: "src", selectedIds: ["src"], stageTab: "plot", worksheetId: null,
    history: [], future: [], staleDatasets: [], status: "",
  });
}
const frozenCount = () => useApp.getState().datasets.filter((d) => /\(frozen\)/.test(d.name)).length;

beforeEach(() => vi.clearAllMocks());

describe("Freeze outputs does not retarget the user's context", () => {
  it("one linked output: Freeze data adds the worksheet and keeps the active dataset, selection and tab", async () => {
    seed(["a"]);
    render(<AnalysisResultPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Freeze data" }));
    await waitFor(() => expect(frozenCount()).toBe(1));
    const st = useApp.getState();
    expect(st.activeId).toBe("src");
    expect(st.selectedIds).toEqual(["src"]);
    expect(st.stageTab).toBe("plot");
    expect(st.status).toMatch(/froze/);
  });

  it("several outputs: Freeze selected adds the worksheets and keeps the active dataset", async () => {
    seed(["a", "b"]);
    render(<AnalysisResultPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Freeze…" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Out a" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Out b" }));
    fireEvent.click(screen.getByRole("button", { name: /Freeze selected \(2\)/ }));
    await waitFor(() => expect(frozenCount()).toBe(2));
    expect(useApp.getState().activeId).toBe("src");
    expect(useApp.getState().selectedIds).toEqual(["src"]);
    expect(useApp.getState().stageTab).toBe("plot");
  });

  it("the single-output freeze is still one undo step", async () => {
    seed(["a"]);
    render(<AnalysisResultPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Freeze data" }));
    await waitFor(() => expect(frozenCount()).toBe(1));
    useApp.getState().undo();
    expect(frozenCount()).toBe(0);
    expect(useApp.getState().activeId).toBe("src");
  });
});
