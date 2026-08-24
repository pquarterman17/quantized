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

  it("shows project coverage, omissions, and retained filtered records once disclosed", () => {
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
    // UX-R3: a "low-value technical artifact" group tucks behind disclosure
    // BY DEFAULT — the group header renders, but its entries do not, until
    // the user opens it.
    expect(screen.queryByText(/XMCD · Best effort/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Origin fidelity"));
    fireEvent.click(screen.getByText(/XMCD · Best effort/));
    expect(screen.getByText(/67\/128 graph records editable/)).toBeInTheDocument();
    expect(screen.getByText(/drawn arrows and shapes/)).toBeInTheDocument();
    expect(screen.getByText(/saved Origin preview/)).toBeInTheDocument();
    expect(screen.getByText(/Filtered: SYSTEM/)).toBeInTheDocument();
    expect(screen.getByText(/1 workbook thumbnails excluded/)).toBeInTheDocument();
  });

  it("defaults collapsed (UX-R3 tuck-behind-disclosure) but never discards the manifest — one click reveals it", () => {
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
    // Tucked, not discarded: the header (with its count) is visible; the
    // per-project summary is one click away, never gone.
    expect(screen.getByText("Origin fidelity")).toBeInTheDocument();
    expect(screen.queryByText(/XRD · Best effort/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Origin fidelity"));
    expect(screen.getByText(/XRD · Best effort/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Origin fidelity"));
    expect(screen.queryByText(/XRD · Best effort/)).not.toBeInTheDocument();
  });
});
