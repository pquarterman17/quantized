import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it , vi } from "vitest";

import { askConfirm } from "../../overlays/ConfirmDialog";

vi.mock("../../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

import ReportPanel from "./ReportPanel";
import type { ReportEntry } from "../../../lib/report";
import { useApp } from "../../../store/useApp";

const ENTRY: ReportEntry = {
  id: "rep-1",
  name: "Linear fit — scan A",
  datasetId: null,
  report: {
    title: "Linear fit — scan A",
    created: "2026-07-07T00:00:00+00:00",
    source_refs: [{ kind: "dataset", id: "d1", name: "scan A" }],
    sections: [
      {
        title: "Fit results",
        blocks: [
          { type: "text", text: "Model: Linear" },
          {
            type: "params",
            params: [{ name: "slope", value: 2, error: 0.1, unit: "K" }],
            caption: "Fitted parameters",
          },
          {
            type: "table",
            columns: ["Metric", "Value"],
            rows: [
              ["R²", 0.998],
              ["Points", null],
            ],
            caption: "Goodness of fit",
          },
          { type: "figure", name: "fig-7", caption: "overlay" },
        ],
      },
    ],
  },
};

beforeEach(() => {
  useApp.setState({ reports: [ENTRY], openReportId: "rep-1" });
});

describe("ReportPanel", () => {
  it("renders every block type of the open report", () => {
    render(<ReportPanel />);
    expect(screen.getByText("Model: Linear")).toBeInTheDocument();
    expect(screen.getByText("slope")).toBeInTheDocument();
    expect(screen.getByText(/± 0.1 K/)).toBeInTheDocument(); // params value ± error unit
    expect(screen.getByText("R²")).toBeInTheDocument();
    expect(screen.getByText("Goodness of fit")).toBeInTheDocument();
    expect(screen.getByText(/figure: overlay/)).toBeInTheDocument(); // reference-only figure
    expect(screen.getByText(/from scan A/)).toBeInTheDocument(); // source refs in header
  });

  it("collapses a section on header click", () => {
    render(<ReportPanel />);
    fireEvent.click(screen.getByText("Fit results"));
    expect(screen.queryByText("Model: Linear")).not.toBeInTheDocument();
  });

  it("renders nothing when the open id is stale", () => {
    useApp.setState({ openReportId: "gone" });
    const { container } = render(<ReportPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  // #17: a saved report is accumulated analysis output with no undo entry, so
  // deleting it confirms first.
  it("Delete report removes it and closes the viewer, once confirmed", async () => {
    vi.mocked(askConfirm).mockResolvedValue(true);
    render(<ReportPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Delete report" }));
    await Promise.resolve();
    const s = useApp.getState();
    expect(s.reports).toHaveLength(0);
    expect(s.openReportId).toBeNull();
  });

  it("declining the confirm keeps the report", async () => {
    vi.mocked(askConfirm).mockResolvedValue(false);
    render(<ReportPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Delete report" }));
    await Promise.resolve();
    expect(useApp.getState().reports).toHaveLength(1);
  });
});
