import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useApp } from "../../store/useApp";
import OriginFidelitySection from "./OriginFidelitySection";

beforeEach(() => useApp.setState({ originFidelity: [] }));

describe("OriginFidelitySection", () => {
  it("renders nothing without an Origin fidelity manifest", () => {
    const { container } = render(<OriginFidelitySection />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows project coverage, omissions, and retained filtered records", () => {
    useApp.setState({
      originFidelity: [
        {
          id: "fidelity-d1",
          stem: "XMCD",
          siblingIds: ["d1"],
          manifest: {
            version: 1,
            container: "opj",
            status: "best_effort",
            graph_records_total: 128,
            graph_records_actionable: 67,
            graph_records_filtered: 61,
            omissions: ["graphic_objects", "saved_graph_preview"],
            filtered_figures: [
              { index: 2, name: "SYSTEM", layer: null, reason: "no bound curves" },
            ],
            preview_diagnostics: [
              { page_name: "Book1", status: "workbook_thumbnail", asset_count: 1 },
            ],
          },
        },
      ],
    });

    render(<OriginFidelitySection />);
    fireEvent.click(screen.getByText(/XMCD · Best effort/));
    expect(screen.getByText(/67\/128 graph records editable/)).toBeInTheDocument();
    expect(screen.getByText(/drawn arrows and shapes/)).toBeInTheDocument();
    expect(screen.getByText(/saved Origin preview/)).toBeInTheDocument();
    expect(screen.getByText(/Filtered: SYSTEM/)).toBeInTheDocument();
    expect(screen.getByText(/1 workbook thumbnails excluded/)).toBeInTheDocument();
  });

  it("collapses the project manifests from the group header", () => {
    useApp.setState({
      originFidelity: [
        {
          id: "fidelity-d1",
          stem: "XRD",
          siblingIds: ["d1"],
          manifest: {
            version: 1,
            container: "opj",
            status: "best_effort",
            graph_records_total: 1,
            graph_records_actionable: 1,
            graph_records_filtered: 0,
            omissions: [],
            filtered_figures: [],
          },
        },
      ],
    });
    render(<OriginFidelitySection />);
    expect(screen.getByText(/XRD · Best effort/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Origin fidelity"));
    expect(screen.queryByText(/XRD · Best effort/)).not.toBeInTheDocument();
  });
});
