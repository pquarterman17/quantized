import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useSimsDialog } from "../../../store/simsDialog";
import { useApp } from "../../../store/useApp";
import QuickFigureBuilderWorkspace from "../quickfigurebuilder/QuickFigureBuilderWorkspace";
import TechniqueWorkspace from "./TechniqueWorkspace";
import { openOriginMigrationReview, openTechniqueWorkflow } from "../../../lib/workflowWorkspace";

function dataset(id: string, technique: string, pending = false): Dataset {
  return {
    id,
    name: `${id}.dat`,
    data: {
      time: [0, 1, 2],
      values: [[1, 10], [2, 20], [3, 30]],
      labels: ["Signal", "Reference"],
      units: ["c/s", "c/s"],
      metadata: { technique, parser_name: "import_sims", x_label: "Depth", x_unit: "nm" },
    },
    ...(pending ? { pending: { kind: "path" as const, path: "C:/x.opju", bookId: id, rows: 300, cols: 2 } } : {}),
  };
}

beforeEach(() => {
  openTechniqueWorkflow();
  useSimsDialog.setState({ seed: null, opened: 0, requestedTab: "process" });
  useApp.setState({
    datasets: [], activeId: null, selectedIds: [], editableFigures: [], reports: [], originFigures: [], originFidelity: [],
    history: [], future: [], status: "", quickFigureBuilderDatasetId: null,
  });
});

describe("TechniqueWorkspace", () => {
  it("has a safe, closable empty state", () => {
    const close = vi.fn();
    render(<TechniqueWorkspace onClose={close} />);
    expect(screen.getByText("Choose a worksheet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to plot" }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("routes an explicit Origin review into the same uncluttered Workflow surface", () => {
    useApp.setState({
      originFidelity: [{
        id: "f1", stem: "sample", siblingIds: ["d1"],
        manifest: { version: 1, container: "opj", status: "best_effort", graph_records_total: 0, graph_records_actionable: 0, graph_records_filtered: 0, omissions: [], filtered_figures: [] },
      }],
    });
    openOriginMigrationReview("f1");
    render(<TechniqueWorkspace onClose={() => {}} />);
    expect(screen.getByRole("heading", { name: "sample" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Technique workflow" }));
    expect(screen.getByRole("heading", { name: "Choose a worksheet" })).toBeInTheDocument();
  });

  it("updates the Origin review target while Workflow is already mounted", () => {
    useApp.setState({
      originFidelity: ["alpha", "beta"].map((stem, index) => ({
        id: `f${index + 1}`, stem, siblingIds: [`d${index + 1}`],
        manifest: { version: 1 as const, container: "opj" as const, status: "best_effort" as const, graph_records_total: 0, graph_records_actionable: 0, graph_records_filtered: 0, omissions: [], filtered_figures: [] },
      })),
    });
    openOriginMigrationReview("f1");
    render(<TechniqueWorkspace onClose={() => {}} />);
    expect(screen.getByRole("heading", { name: "alpha" })).toBeInTheDocument();
    act(() => openOriginMigrationReview("f2"));
    expect(screen.getByRole("heading", { name: "beta" })).toBeInTheDocument();
  });

  it("shows the declared technique, provenance, dimensions, and existing results without mutating science state", () => {
    const ds = { ...dataset("s1", "sims"), fitSpec: { model: "linear" } } as Dataset;
    useApp.setState({ datasets: [ds], activeId: "s1", selectedIds: ["s1"] });
    const before = JSON.stringify({ datasets: useApp.getState().datasets, history: useApp.getState().history });
    render(<TechniqueWorkspace onClose={() => {}} />);
    expect(screen.getByRole("heading", { name: "SIMS depth profile" })).toBeInTheDocument();
    expect(screen.getByText("3 rows · 2 columns")).toBeInTheDocument();
    expect(screen.getByText("Depth (nm)")).toBeInTheDocument();
    expect(screen.getByText("sims")).toBeInTheDocument();
    expect(screen.getByText("Fit result")).toBeInTheDocument();
    expect(JSON.stringify({ datasets: useApp.getState().datasets, history: useApp.getState().history })).toBe(before);
  });

  it("is honest about generic data and exposes the Quick Plot refusal reason", () => {
    const ds = dataset("g1", "generic");
    useApp.setState({ datasets: [ds], activeId: "g1" });
    render(<TechniqueWorkspace onClose={() => {}} />);
    expect(screen.getByText(/will not guess a scientific workflow/i)).toBeInTheDocument();
    expect(screen.getByText(/instead of guessing/i)).toBeInTheDocument();
    const quick = screen.getByRole("button", { name: /Quick Plot/i });
    expect(quick).toBeDisabled();
    expect(quick).toHaveAttribute("title", expect.stringContaining("unrecognized data"));
  });

  it("opens the requested SIMS sub-workflow, not always Process", async () => {
    const ds = dataset("s1", "sims");
    useApp.setState({ datasets: [ds], activeId: "s1" });
    render(<TechniqueWorkspace onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Compare profiles/i }));
    await waitFor(() => expect(useSimsDialog.getState()).toMatchObject({ seed: "s1", requestedTab: "compare" }));
  });

  it("resolves a lazy Origin book before configuring a figure", async () => {
    const preview = dataset("lazy", "sims", true);
    const full = { ...preview, pending: undefined, data: { ...preview.data, time: Array.from({ length: 300 }, (_, i) => i) } };
    let finish!: (value: Dataset) => void;
    const resolving = new Promise<Dataset>((resolve) => { finish = resolve; });
    useApp.setState({
      datasets: [preview], activeId: "lazy",
      resolveDataset: vi.fn(async () => resolving),
    });
    render(<TechniqueWorkspace onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Configure figure/i }));
    expect(useApp.getState().quickFigureBuilderDatasetId).toBeNull();
    expect(useApp.getState().status).toContain("Loading full data");
    act(() => {
      useApp.setState({ datasets: [full] });
      finish(full);
    });
    await waitFor(() => expect(useApp.getState().quickFigureBuilderDatasetId).toBe("lazy"));
    expect(useApp.getState().stageTab).toBe("plot");
    expect(useApp.getState().status).toContain("Full data loaded");
  });

  it("creates a configured figure into a visible Plot stage from Workflow", async () => {
    const ds = dataset("s1", "sims");
    useApp.setState({ datasets: [ds], activeId: "s1", stageTab: "technique" });
    render(<><TechniqueWorkspace onClose={() => {}} /><QuickFigureBuilderWorkspace /></>);

    fireEvent.click(screen.getByRole("button", { name: /Configure figure/i }));
    await waitFor(() => expect(useApp.getState().quickFigureBuilderDatasetId).toBe("s1"));
    expect(useApp.getState().stageTab).toBe("plot");
    fireEvent.click(screen.getByRole("button", { name: "Create Editable Figure" }));
    expect(useApp.getState().editableFigures).toHaveLength(1);
    expect(useApp.getState().quickFigureBuilderDatasetId).toBeNull();
    expect(useApp.getState().stageTab).toBe("plot");
  });

  it("cancels a resolved action if the active worksheet changed while it loaded", async () => {
    const preview = dataset("lazy", "sims", true);
    const other = dataset("other", "transport");
    const full = { ...preview, pending: undefined };
    let finish!: (value: Dataset) => void;
    const resolving = new Promise<Dataset>((resolve) => { finish = resolve; });
    useApp.setState({ datasets: [preview, other], activeId: "lazy", resolveDataset: vi.fn(async () => resolving) });
    render(<TechniqueWorkspace onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Configure figure/i }));
    act(() => {
      useApp.setState({ datasets: [full, other], activeId: "other" });
      finish(full);
    });
    await waitFor(() => expect(useApp.getState().status).toContain("active worksheet changed"));
    expect(useApp.getState().quickFigureBuilderDatasetId).toBeNull();
  });
});
