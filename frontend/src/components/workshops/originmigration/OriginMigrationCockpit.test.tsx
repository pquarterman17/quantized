import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset, OriginFigure } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import OriginMigrationCockpit from "./OriginMigrationCockpit";
import { clearOriginReviewDeferred } from "../../../lib/workflowWorkspace";

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
    fireEvent.click(screen.getByRole("button", { name: "All graphs (2)" }));
    expect(screen.getByRole("heading", { name: "Recovered" })).toBeInTheDocument();
    expect(JSON.stringify(useApp.getState().datasets)).toBe(before);
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
});
