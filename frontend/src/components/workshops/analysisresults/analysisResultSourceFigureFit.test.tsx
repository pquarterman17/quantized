// Gap audit 5 lane C: a fit result's "Build source figure" creates an editable
// figure that KEEPS the fitted curve (it used to say "editable figures do not
// yet store fit overlays"), through the same I4 gate Open plot uses.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { fitAnalysisResult } from "../../../lib/fitAnalysisResult";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { loadWindowOverlays } from "../../../store/windowOverlaysLazy";

const mocks = vi.hoisted(() => ({ fitBands: vi.fn() }));
vi.mock("../../../lib/api/fitStats", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/fitStats")>()), fitBands: mocks.fitBands,
}));
vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => <section aria-label={title}>{children}</section>,
}));

import AnalysisResultPanel from "./AnalysisResultPanel";

const fitted: Dataset = {
  id: "source",
  name: "Raw trace",
  data: { time: [0, 1, 2], values: [[1], [3], [5]], labels: ["Signal"], units: ["V"], metadata: {} },
  fitSpec: { model: "Linear", xKey: null, yKey: 0, params: [1, 2], nPoints: 3, nFree: 2 },
};

beforeAll(async () => { await loadWindowOverlays(); });

beforeEach(() => {
  mocks.fitBands.mockReset();
  mocks.fitBands.mockImplementation(async ({ x }: { x: number[] }) => ({ yFit: x.map((v) => 1 + 2 * v) }));
  useApp.setState(useApp.getInitialState(), true);
});

function openResult(dataset: Dataset): void {
  const result = fitAnalysisResult(dataset, dataset.fitSpec!);
  useApp.setState({ datasets: [dataset], analysisResults: [result], openAnalysisResultId: result.id, staleFits: [] });
  render(<AnalysisResultPanel />);
  fireEvent.click(screen.getByRole("tab", { name: "Figures" }));
}

describe("Build source figure keeps the fit", () => {
  it("says so, and the figure created from the builder carries the regenerated curve", async () => {
    openResult(fitted);
    expect(screen.getByText(/the saved figure keeps the fitted curve/)).toBeInTheDocument();
    expect(screen.queryByText(/do not yet store fit overlays/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Build source figure" }));
    await waitFor(() => expect(useApp.getState().quickFigureBuilderDatasetId).toBe("source"));
    // The result's fit is drawn (regenerated from the saved model), as Open plot does.
    expect(useApp.getState().fitOverlay).toEqual({ datasetId: "source", binding: { yKey: 0, xKey: null }, y: [1, 3, 5] });

    const s = useApp.getState();
    expect(s.createQuickFigureFromMapping("source", s.quickFigureBuilderSeed!, "line")).toBe(true);
    const figure = useApp.getState().editableFigures.at(-1)!;
    expect(figure.overlays?.fit?.y).toEqual([1, 3, 5]);
    // Its window took focus, so the canvas draws the fit it keeps.
    expect(useApp.getState().fitOverlay).toEqual({ datasetId: "source", binding: { yKey: 0, xKey: null }, y: [1, 3, 5] });
  });

  it("a legacy fit with no recorded X builds the figure WITHOUT a fit and says why", async () => {
    openResult({ ...fitted, fitSpec: { model: "Linear", params: [1, 2] } });
    fireEvent.click(screen.getByRole("button", { name: "Build source figure" }));
    await waitFor(() => expect(useApp.getState().quickFigureBuilderDatasetId).toBe("source"));
    expect(useApp.getState().fitOverlay).toBeNull();
    expect(useApp.getState().status).toMatch(/the figure is built without the fit: the saved fit never recorded its X/);
    expect(mocks.fitBands).not.toHaveBeenCalled();
  });

  it("the fit never rides onto a different worksheet than the one it was evaluated on", async () => {
    openResult(fitted);
    fireEvent.click(screen.getByRole("button", { name: "Build source figure" }));
    await waitFor(() => expect(useApp.getState().fitOverlay).not.toBeNull());
    const other: Dataset = { ...fitted, id: "other", name: "Other", fitSpec: undefined };
    useApp.setState((s) => ({ datasets: [...s.datasets, other] }));
    const s = useApp.getState();
    expect(s.createQuickFigureFromMapping("other", s.quickFigureBuilderSeed!, "line")).toBe(true);
    expect(useApp.getState().editableFigures.at(-1)!.overlays).toBeUndefined();
  });
});
