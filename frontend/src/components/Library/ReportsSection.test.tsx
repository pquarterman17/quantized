import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { ReportEntry } from "../../lib/report";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import ReportsSection from "./ReportsSection";

const d1: Dataset = {
  id: "d1",
  name: "scan A",
  data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} },
};

const rep = (over: Partial<ReportEntry> = {}): ReportEntry => ({
  id: "rep-1",
  name: "Linear fit — scan A",
  datasetId: "d1",
  report: {
    title: "Linear fit — scan A",
    sections: [{ title: "Fit results", blocks: [{ type: "text", text: "Model: Linear" }] }],
  },
  ...over,
});

beforeEach(() => {
  useApp.setState({ datasets: [d1], reports: [], openReportId: null });
});

describe("ReportsSection", () => {
  it("renders nothing without any reports", () => {
    const { container } = render(<ReportsSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists reports with their source dataset name and opens on click", () => {
    useApp.setState({ reports: [rep()] });
    render(<ReportsSection />);
    const row = screen.getByRole("button", { name: /Linear fit — scan A/ });
    expect(row).toHaveTextContent("scan A");
    fireEvent.click(row);
    expect(useApp.getState().openReportId).toBe("rep-1");
  });

  it("still lists (and opens) a report whose dataset was removed", () => {
    useApp.setState({ datasets: [], reports: [rep({ datasetId: null })] });
    render(<ReportsSection />);
    const row = screen.getByRole("button", { name: /Linear fit/ });
    expect(row).not.toBeDisabled();
    fireEvent.click(row);
    expect(useApp.getState().openReportId).toBe("rep-1");
  });

  it("collapses/expands via the section header", () => {
    useApp.setState({ reports: [rep()] });
    render(<ReportsSection />);
    fireEvent.click(screen.getByText("Reports"));
    expect(screen.queryByRole("button", { name: /Linear fit/ })).not.toBeInTheDocument();
  });

  it("store: removing the source dataset nulls the ref but keeps the report", () => {
    useApp.setState({ reports: [rep()] });
    useApp.getState().removeDataset("d1");
    const s = useApp.getState();
    expect(s.reports).toHaveLength(1);
    expect(s.reports[0].datasetId).toBeNull();
  });

  it("store: addReport opens the viewer on the new report", () => {
    useApp.getState().addReport("t", { title: "t", sections: [] }, "d1");
    const s = useApp.getState();
    expect(s.reports).toHaveLength(1);
    expect(s.openReportId).toBe(s.reports[0].id);
    expect(s.reports[0].datasetId).toBe("d1");
  });
});
