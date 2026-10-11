import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalysisResult } from "../../../lib/analysisResult";
import type { Dataset } from "../../../lib/types";
import { resetAnalysisCenterPreferencesForTests, useAnalysisCenter } from "../../../store/analysisCenter";
import { useApp } from "../../../store/useApp";
import AnalysisCenter from "./AnalysisCenter";

function dataset(technique = "generic"): Dataset {
  return {
    id: "d1", name: "measurements.csv",
    data: {
      time: Array.from({ length: 12 }, (_, index) => index),
      values: Array.from({ length: 12 }, (_, index) => [index, index * 2, index % 2]),
      labels: ["A", "B", "Group"], units: ["", "", ""], metadata: { technique },
    },
  };
}

beforeEach(() => {
  resetAnalysisCenterPreferencesForTests();
  useApp.setState({ datasets: [], activeId: null, selectedIds: [], analysisResults: [], openAnalysisResultId: null, curveFitOpen: false, stageTab: "technique" });
});

describe("AnalysisCenter", () => {
  it("is useful without a worksheet and gives a reason for disabled tools", () => {
    render(<AnalysisCenter onClose={() => {}} onBack={() => {}} />);
    expect(screen.getByRole("heading", { name: "Analysis Center" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /DiraCulator/ })).toBeInTheDocument();
    const fit = screen.getByRole("heading", { name: "Curve fit" }).closest("article");
    expect(fit).not.toBeNull();
    expect(within(fit!).getByText("Select a worksheet first.")).toBeInTheDocument();
    expect(within(fit!).getByRole("button", { name: "Open tool" })).toBeDisabled();
  });

  it("searches tools, records a recent launch, and invokes the canonical command once", async () => {
    const close = vi.fn();
    const ds = dataset();
    useApp.setState({ datasets: [ds], activeId: ds.id, selectedIds: [ds.id] });
    render(<AnalysisCenter onClose={close} onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "All tools" }));
    fireEvent.change(screen.getByLabelText("Search tools and results"), { target: { value: "nonlinear regression" } });
    const fit = screen.getByRole("heading", { name: "Curve fit" }).closest("article");
    fireEvent.click(within(fit!).getByRole("button", { name: "Open tool" }));
    await waitFor(() => expect(useApp.getState().curveFitOpen).toBe(true));
    expect(close).toHaveBeenCalledOnce();
    expect(useAnalysisCenter.getState().recent[0]).toBe("curvefit");
  });

  it("favorites tools without launching or changing scientific data", () => {
    const ds = dataset();
    useApp.setState({ datasets: [ds], activeId: ds.id });
    render(<AnalysisCenter onClose={() => {}} onBack={() => {}} />);
    const before = useApp.getState().datasets;
    fireEvent.click(screen.getByLabelText("Add Curve fit to favorites"));
    fireEvent.click(screen.getByRole("button", { name: /Favorites/ }));
    expect(screen.getByRole("heading", { name: "Curve fit" })).toBeInTheDocument();
    expect(useApp.getState().datasets).toBe(before);
  });

  it("resolves an Origin preview before launching analysis", async () => {
    const preview = { ...dataset(), pending: { kind: "path" as const, path: "C:/project.opju", bookId: "b1", rows: 1200, cols: 3 } };
    const full = { ...preview, pending: undefined };
    const resolveDataset = vi.fn(async () => {
      useApp.setState({ datasets: [full] });
      return full;
    });
    useApp.setState({ datasets: [preview], activeId: preview.id, resolveDataset });
    render(<AnalysisCenter onClose={() => {}} onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "All tools" }));
    const fit = screen.getByRole("heading", { name: "Curve fit" }).closest("article");
    fireEvent.click(within(fit!).getByRole("button", { name: "Open tool" }));
    await waitFor(() => expect(useApp.getState().curveFitOpen).toBe(true));
    expect(resolveDataset).toHaveBeenCalledWith(preview.id);
  });

  it("lists saved results with current-worksheet priority and opens the result authority", () => {
    const ds = dataset();
    const result: AnalysisResult = {
      version: 1, id: "r1", name: "Linear fit", producer: { id: "fit", label: "Curve fit", version: 1 },
      sources: [{ datasetId: ds.id, role: "input" }], outputs: [], warnings: [], createdAt: "2026-10-10T12:00:00Z",
    };
    useApp.setState({ datasets: [ds], activeId: ds.id, analysisResults: [result] });
    render(<AnalysisCenter onClose={() => {}} onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Existing results/ }));
    expect(screen.getByText("Current worksheet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open result" }));
    expect(useApp.getState().openAnalysisResultId).toBe("r1");
  });
});
