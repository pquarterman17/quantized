import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset, OriginFigure } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { loadOriginApplyLibs } from "../../../store/originApplyLibs";
import OriginMigrationCockpit from "./OriginMigrationCockpit";
import { clearOriginReviewDeferred } from "../../../lib/workflowWorkspace";

const applyOriginFigure = useApp.getState().applyOriginFigure;

beforeAll(async () => {
  await loadOriginApplyLibs();
});

function dataset(): Dataset {
  return {
    id: "d1",
    name: "Book1",
    data: {
      time: [1, 2], values: [[3], [4]], labels: ["Y"], units: [""],
      metadata: { origin_book: "Book1", origin_column_names: ["B"] },
    },
  } as Dataset;
}

function figure(name: string, book: string, status: "exact" | "best_effort" = "exact"): OriginFigure {
  return {
    name, x_from: 0, x_to: 2, x_log: false, y_from: 0, y_to: 5, y_log: false,
    n_curves: 1, annotations: [], curves: [{ book, x: "", y: "B" }],
    fidelity: { status, recovered: [], omissions: [] },
  };
}

beforeEach(() => {
  clearOriginReviewDeferred();
  useApp.setState({
    datasets: [], originFigures: [], originFidelity: [], history: [], future: [],
    applyOriginFigure: vi.fn(), openOriginFigureSource: vi.fn(async () => true),
  });
});

describe("OriginMigrationCockpit", () => {
  it("has a safe empty state after an import is removed", () => {
    const close = vi.fn();
    render(<OriginMigrationCockpit onClose={close} />);
    expect(screen.getByRole("heading", { name: "No Origin import to review" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to plot" }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("puts unresolved graphs on the attention path without hiding recovered work", () => {
    const ds = dataset();
    useApp.setState({
      datasets: [ds],
      originFidelity: [{
        id: "f1", stem: "sample", siblingIds: ["d1"],
        manifest: {
          version: 1, container: "opj", status: "best_effort",
          graph_records_total: 3, graph_records_actionable: 2, graph_records_filtered: 1,
          omissions: ["graphic_objects"],
          filtered_figures: [{ index: 9, name: "SYSTEM", layer: null, reason: "no bound curves" }],
        },
      }],
      originFigures: [
        { id: "good", stem: "sample", siblingIds: ["d1"], datasetId: "d1", figure: figure("Recovered", "Book1") },
        { id: "bad", stem: "sample", siblingIds: ["d1"], datasetId: null, figure: figure("Broken", "Missing") },
      ],
    });

    const before = JSON.stringify(useApp.getState().datasets);
    render(<OriginMigrationCockpit initialFidelityId="f1" onClose={() => {}} />);
    expect(screen.getByRole("heading", { name: "Broken" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Recovered" })).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Unresolved saved sources" })).toHaveTextContent("Missing · X → B");
    expect(screen.getByRole("button", { name: "Missing · book not imported (1 graph)" })).toBeInTheDocument();
    expect(screen.getByText(/drawn arrows and shapes/)).toBeInTheDocument();
    expect(screen.getByText("reference only").parentElement).toHaveTextContent("0reference only");
    fireEvent.click(screen.getByRole("button", { name: "All graphs (2)" }));
    expect(screen.getByRole("heading", { name: "Recovered" })).toBeInTheDocument();
    expect(JSON.stringify(useApp.getState().datasets)).toBe(before);
  });

  it("does not snap a manual project choice back when live store data updates", () => {
    const first = dataset();
    const second = { ...dataset(), id: "d2", name: "Book2", data: { ...dataset().data, metadata: { origin_book: "Book2", origin_column_names: ["B"] } } } as Dataset;
    useApp.setState({
      datasets: [first, second],
      originFidelity: [
        { id: "f1", stem: "alpha", siblingIds: ["d1"], manifest: { version: 1, container: "opj", status: "exact", graph_records_total: 0, graph_records_actionable: 0, graph_records_filtered: 0, omissions: [], filtered_figures: [] } },
        { id: "f2", stem: "beta", siblingIds: ["d2"], manifest: { version: 1, container: "opj", status: "exact", graph_records_total: 0, graph_records_actionable: 0, graph_records_filtered: 0, omissions: [], filtered_figures: [] } },
      ],
    });
    render(<OriginMigrationCockpit initialFidelityId="f1" onClose={() => {}} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search graph windows" }), {
      target: { value: "old project query" },
    });
    fireEvent.change(screen.getByLabelText("Imported project"), { target: { value: "f2" } });
    expect(screen.getByRole("heading", { name: "beta" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search graph windows" })).toHaveValue("");

    act(() => useApp.setState({ datasets: [...useApp.getState().datasets] }));
    expect(screen.getByRole("heading", { name: "beta" })).toBeInTheDocument();
    expect(screen.getByLabelText("Imported project")).toHaveValue("f2");
  });

  it("marks review-later locally and still allows the user to return it to review", () => {
    useApp.setState({
      datasets: [dataset()],
      originFidelity: [{
        id: "f1", stem: "sample", siblingIds: ["d1"],
        manifest: { version: 1, container: "opj", status: "best_effort", graph_records_total: 1, graph_records_actionable: 1, graph_records_filtered: 0, omissions: [], filtered_figures: [] },
      }],
      originFigures: [{ id: "bad", stem: "sample", siblingIds: ["d1"], datasetId: null, figure: figure("Broken", "Missing") }],
    });
    const { unmount } = render(<OriginMigrationCockpit onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Review later" }));
    expect(screen.getByText("Review later", { selector: ".qz-badge" })).toBeInTheDocument();
    unmount();
    render(<OriginMigrationCockpit onClose={() => {}} />);
    expect(screen.getByText("Review later", { selector: ".qz-badge" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Return to review" }));
    expect(screen.queryByText("Review later", { selector: ".qz-badge" })).not.toBeInTheDocument();
  });

  it("keeps existing review-later marks when another Origin import is appended", async () => {
    const manifest = { version: 1 as const, container: "opj" as const, status: "best_effort" as const, graph_records_total: 1, graph_records_actionable: 1, graph_records_filtered: 0, omissions: [], filtered_figures: [] };
    const first = { id: "f1", stem: "sample", siblingIds: ["d1"], manifest };
    useApp.setState({
      datasets: [dataset()],
      originFidelity: [first],
      originFigures: [{ id: "bad", stem: "sample", siblingIds: ["d1"], datasetId: null, figure: figure("Broken", "Missing") }],
    });
    const { unmount } = render(<OriginMigrationCockpit onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Review later" }));
    unmount();
    act(() => useApp.setState({
      originFidelity: [first, { ...first, id: "f2", stem: "second" }],
    }));
    render(<OriginMigrationCockpit initialFidelityId="f1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("Review later", { selector: ".qz-badge" })).toBeInTheDocument());
  });

  it("opens an editable Origin graph into the visible Plot stage from Workflow", () => {
    const ds = dataset();
    useApp.setState({
      datasets: [ds], activeId: "d1", stageTab: "technique", applyOriginFigure,
      originFidelity: [{
        id: "f1", stem: "sample", siblingIds: ["d1"],
        manifest: { version: 1, container: "opj", status: "best_effort", graph_records_total: 1, graph_records_actionable: 1, graph_records_filtered: 0, omissions: [], filtered_figures: [] },
      }],
      originFigures: [{ id: "open-me", stem: "sample", siblingIds: ["d1"], datasetId: "d1", figure: figure("Editable", "Book1", "best_effort") }],
    });
    render(<OriginMigrationCockpit initialFidelityId="f1" onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Open editable graph" }));
    expect(useApp.getState().stageTab).toBe("plot");
  });

  it("previews and atomically applies one source choice across repeated graph layers", async () => {
    const ds = dataset();
    const missing = (id: string, name: string) => ({
      id, stem: "sample", siblingIds: ["d1"], datasetId: null,
      figure: figure(name, "Missing"),
    });
    useApp.setState({
      datasets: [ds],
      originFidelity: [{
        id: "f1", stem: "sample", siblingIds: ["d1"],
        manifest: { version: 1, container: "opj", status: "best_effort", graph_records_total: 2, graph_records_actionable: 2, graph_records_filtered: 0, omissions: [], filtered_figures: [] },
      }],
      originFigures: [missing("g1", "Graph 1"), missing("g2", "Graph 2")],
      history: [], future: [],
    });
    render(<OriginMigrationCockpit initialFidelityId="f1" onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Missing · book not imported (2 graphs)" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview bulk resolution…" }));

    const previewButton = await screen.findByRole("button", { name: "Preview Book1" });
    fireEvent.click(previewButton);
    expect(screen.getByRole("region", { name: "Bulk resolution preview" })).toHaveTextContent("2 saved bindings across 2 layers");
    fireEvent.click(screen.getByRole("button", { name: "Apply to 2 layers" }));

    await waitFor(() => expect(useApp.getState().originFigures.every(
      (entry) => entry.sourceOverrides?.Missing === "d1",
    )).toBe(true));
    expect(screen.getByRole("region", { name: "Saved Origin source mappings" })).toHaveTextContent("Missing → Book1 · 2 graphs");
    expect(useApp.getState().history.at(-1)?.label).toBe("resolve Origin source");

    fireEvent.click(screen.getByRole("button", { name: "Clear mapping for Missing" }));
    await waitFor(() => expect(useApp.getState().originFigures.every(
      (entry) => entry.sourceOverrides == null,
    )).toBe(true));
    await waitFor(() => expect(screen.getByRole("button", { name: "Missing · book not imported (2 graphs)" })).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: "Open editable graph" }).every((button) => button.hasAttribute("disabled"))).toBe(true);
  });

  it("clears review-later marks when the Origin project collection is replaced", async () => {
    const manifest = { version: 1 as const, container: "opj" as const, status: "best_effort" as const, graph_records_total: 1, graph_records_actionable: 1, graph_records_filtered: 0, omissions: [], filtered_figures: [] };
    useApp.setState({
      datasets: [dataset()],
      originFidelity: [{ id: "f1", stem: "sample", siblingIds: ["d1"], manifest }],
      originFigures: [{ id: "bad", stem: "sample", siblingIds: ["d1"], datasetId: null, figure: figure("Broken", "Missing") }],
    });
    const { unmount } = render(<OriginMigrationCockpit onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Review later" }));
    unmount();
    act(() => useApp.setState({ originFidelity: [{ id: "f1", stem: "replacement", siblingIds: ["d1"], manifest }] }));
    render(<OriginMigrationCockpit onClose={() => {}} />);
    await waitFor(() => expect(screen.queryByText("Review later", { selector: ".qz-badge" })).not.toBeInTheDocument());
  });

  it("keeps a large Origin project responsive with search, paging, and one bulk review decision", () => {
    const count = 75;
    useApp.setState({
      datasets: [dataset()],
      originFidelity: [{
        id: "f1", stem: "large-project", siblingIds: ["d1"],
        manifest: {
          version: 1, container: "opj", status: "best_effort",
          graph_records_total: count, graph_records_actionable: count,
          graph_records_filtered: 0, omissions: [], filtered_figures: [],
        },
      }],
      originFigures: Array.from({ length: count }, (_unused, index) => ({
        id: `g${index}`, stem: "large-project", siblingIds: ["d1"], datasetId: null,
        figure: figure(`Graph ${index + 1}`, "Missing"),
      })),
    });

    render(<OriginMigrationCockpit initialFidelityId="f1" onClose={() => {}} />);
    expect(screen.getAllByRole("article")).toHaveLength(40);
    expect(screen.getByText("Showing 40 of 75 matching graph windows.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show 35 more" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search graph windows" }), {
      target: { value: "Graph 75" },
    });
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Graph 75" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search graph windows" }), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review matching later" }));
    expect(screen.getAllByText("Review later", { selector: ".qz-badge" })).toHaveLength(40);
    expect(screen.getByRole("button", { name: "Return matching to review" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show 35 more" }));
    expect(screen.getAllByRole("article")).toHaveLength(75);
  });
});
