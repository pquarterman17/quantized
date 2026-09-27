import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it , vi } from "vitest";

import { askConfirm } from "../../overlays/ConfirmDialog";
import { reportExport } from "../../../lib/api/reportExport";

vi.mock("../../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));
vi.mock("../../../lib/api/reportExport", () => ({ reportExport: vi.fn() }));

import ReportPanel, { reportWarningToast } from "./ReportPanel";
import type { ReportEntry } from "../../../lib/report";
import { useToasts } from "../../../store/toasts";
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
  vi.clearAllMocks();
  vi.mocked(reportExport).mockResolvedValue({ warnings: [], warningCount: 0 });
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

  // P0.4 feedback/cancel audit tail: `busy` used to disable every export
  // button with no way to tell which one was running.
  describe("export names the running format", () => {
    it("shows 'Exporting Word…' on the DOCX button while its export runs, others just disabled", async () => {
      let resolve!: () => void;
      vi.mocked(reportExport).mockReturnValue(
        new Promise((r) => (resolve = () => r({ warnings: [], warningCount: 0 }))),
      );
      render(<ReportPanel />);

      fireEvent.click(screen.getByRole("button", { name: "Word" }));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Exporting Word…" })).toBeInTheDocument(),
      );
      expect(screen.getByRole("button", { name: "Exporting Word…" })).toBeDisabled();
      // every other format button stays disabled but keeps its plain label
      expect(screen.getByRole("button", { name: "HTML" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "LaTeX" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "PPT" })).toBeDisabled();

      await act(async () => {
        resolve();
        await Promise.resolve();
      });
      expect(screen.getByRole("button", { name: "Word" })).toBeEnabled();
    });

    it("reverts to the plain label and re-enables the buttons on failure", async () => {
      vi.mocked(reportExport).mockRejectedValue(new Error("export failed"));
      render(<ReportPanel />);
      fireEvent.click(screen.getByRole("button", { name: "HTML" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "HTML" })).toBeEnabled());
    });
  });

  // P3.6: the backend's X-Report-Warnings (figure render failures, the
  // per-report cap, vector->raster fallbacks) must reach the user.
  describe("export warnings", () => {
    it("toasts a one-line summary and lists every warning in the panel", async () => {
      vi.mocked(reportExport).mockResolvedValue({
        warnings: ["figure 'scan' -- not embedded: bad channel", "figure 'b' vector failed"],
        warningCount: 3,
      });
      useToasts.setState({ toasts: [] });
      render(<ReportPanel />);
      fireEvent.click(screen.getByRole("button", { name: "Word" }));
      const panel = await screen.findByTestId("report-export-warnings");
      expect(panel).toHaveTextContent("Last Word export: 3 warnings");
      expect(panel).toHaveTextContent("figure 'scan' -- not embedded: bad channel");
      expect(panel).toHaveTextContent("figure 'b' vector failed");
      expect(panel).toHaveTextContent("1 more not listed");
      const toasts = useToasts.getState().toasts;
      expect(toasts.map((t) => t.msg)).toEqual([
        "Word export finished with 3 warnings: figure 'scan' -- not embedded: bad channel (+2 more)",
      ]);
      expect(toasts[0].kind).toBe("info");
    });

    it("a clean export shows no warnings and clears a previous list", async () => {
      vi.mocked(reportExport).mockResolvedValueOnce({ warnings: ["w"], warningCount: 1 });
      render(<ReportPanel />);
      fireEvent.click(screen.getByRole("button", { name: "HTML" }));
      await screen.findByTestId("report-export-warnings");
      useToasts.setState({ toasts: [] });
      fireEvent.click(screen.getByRole("button", { name: "HTML" }));
      await waitFor(() => expect(screen.queryByTestId("report-export-warnings")).not.toBeInTheDocument());
      expect(useToasts.getState().toasts).toEqual([]);
    });

    it("a failed export clears the previous export's list too", async () => {
      vi.mocked(reportExport).mockResolvedValueOnce({ warnings: ["w"], warningCount: 1 });
      render(<ReportPanel />);
      fireEvent.click(screen.getByRole("button", { name: "HTML" }));
      await screen.findByTestId("report-export-warnings");
      vi.mocked(reportExport).mockRejectedValueOnce(new Error("boom"));
      fireEvent.click(screen.getByRole("button", { name: "PPT" }));
      await waitFor(() => expect(screen.queryByTestId("report-export-warnings")).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole("button", { name: "PPT" })).toBeEnabled());
    });

    it("removing a block clears the list (its figure/section names may now point at nothing)", async () => {
      vi.mocked(reportExport).mockResolvedValueOnce({ warnings: ["w"], warningCount: 1 });
      render(<ReportPanel />);
      fireEvent.click(screen.getByRole("button", { name: "HTML" }));
      await screen.findByTestId("report-export-warnings");
      fireEvent.click(screen.getAllByRole("button", { name: "Remove block" })[0]);
      expect(screen.queryByTestId("report-export-warnings")).not.toBeInTheDocument();
    });

    it("reportWarningToast singularizes and handles a count with no readable text", () => {
      expect(reportWarningToast("PPT", { warnings: ["only"], warningCount: 1 })).toBe(
        "PPT export finished with 1 warning: only",
      );
      expect(reportWarningToast("HTML", { warnings: [], warningCount: 4 })).toBe(
        "HTML export finished with 4 warnings",
      );
    });
  });

  // P3.6: a figure sent from a plot, and per-block move/remove controls.
  describe("rendered figures and block controls", () => {
    const FIG: ReportEntry = {
      id: "rep-f",
      name: "scan figures",
      datasetId: null,
      report: {
        title: "scan figures",
        sections: [
          {
            title: "Figures",
            blocks: [
              { type: "figure", name: "scan", caption: "Hall sweep", spec: { fmt: "svg", dataset: {} } },
              { type: "figure", name: "raw", spec: { fmt: "png", dataset: {} } },
              { type: "text", text: "note" },
            ],
          },
        ],
      },
    };
    const names = () =>
      useApp.getState().reports[0].report.sections[0].blocks.map((b) => (b.type === "figure" ? b.name : b.type));

    beforeEach(() => {
      useApp.setState({ reports: [FIG], openReportId: "rep-f", history: [], future: [] });
    });

    it("shows a spec figure as a rendered-figure card: caption, indicator, and what gets embedded", () => {
      render(<ReportPanel />);
      const cards = screen.getAllByTestId("report-rendered-figure");
      expect(cards).toHaveLength(2);
      expect(cards[0]).toHaveTextContent("rendered figure");
      expect(cards[0]).toHaveTextContent("Hall sweep");
      expect(cards[0]).toHaveTextContent("Word/PowerPoint embed SVG with a PNG fallback, HTML inline SVG");
      expect(cards[0]).toHaveTextContent("LaTeX only references a figure file");
      // no caption: falls back to the block name; png spec = raster only
      expect(cards[1]).toHaveTextContent("raw");
      expect(cards[1]).toHaveTextContent("Word/PowerPoint/HTML embed PNG");
    });

    it("moves a block down/up as undoable steps, disabling moves off either end", () => {
      render(<ReportPanel />);
      const ups = screen.getAllByRole("button", { name: /Move (figure|block) up/ });
      const downs = screen.getAllByRole("button", { name: /Move (figure|block) down/ });
      expect(ups[0]).toBeDisabled();
      expect(downs[2]).toBeDisabled();
      fireEvent.click(downs[0]);
      expect(names()).toEqual(["raw", "scan", "text"]);
      expect(useApp.getState().history.map((h) => h.label)).toEqual(["move report block"]);
      useApp.getState().undo();
      expect(names()).toEqual(["scan", "raw", "text"]);
    });

    it("removes a block as one undo step (undo brings it back)", () => {
      render(<ReportPanel />);
      fireEvent.click(screen.getAllByRole("button", { name: "Remove figure" })[0]);
      expect(names()).toEqual(["raw", "text"]);
      expect(useApp.getState().history.map((h) => h.label)).toEqual(["remove report block"]);
      useApp.getState().undo();
      expect(names()).toEqual(["scan", "raw", "text"]);
    });
  });
});
