// G19 linked report blocks in the viewer: stale badge, refresh block / all,
// source-missing keeps the snapshot, figure link, export with/without refresh.

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));
vi.mock("../../../lib/api/reportExport", () => ({ reportExport: vi.fn() }));

import { reportExport } from "../../../lib/api/reportExport";
import type { AnalysisResult } from "../../../lib/analysisResult";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { createFigureDocument } from "../../../lib/figureDocument";
import { defaultPlotView } from "../../../lib/plotview";
import { figureKey } from "../../../lib/reportLinkFigure";
import type { ReportBlock, ReportEntry } from "../../../lib/report";
import { linkBlockToResult } from "../../../lib/reportLinks";
import type { Dataset } from "../../../lib/types";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import ReportPanel from "./ReportPanel";

const COLUMNS = ["level", "term", "estimate", "SE"];
const dataset = (v: number): Dataset => ({
  id: "s", name: "scan",
  data: { time: [0, 1, 2], values: [[1], [2], [v]], labels: ["Y"], units: [""], metadata: {} },
});
const result = (ds: Dataset, slope: number): AnalysisResult => ({
  version: 1, id: "res", name: "Fit Y by X",
  producer: { id: "fit-y-by-x", label: "Fit Y by X", version: 1 }, sources: [{ datasetId: "s", role: "input" }], outputs: [],
  tables: [{ title: "Estimates", columns: COLUMNS, rows: [["all", "slope", slope, 0.1]] }],
  warnings: [], createdAt: "2026-11-25T00:00:00Z", sourceFingerprint: analysisDataFingerprint(ds),
});
const snapshot = (slope: number): ReportBlock => ({ type: "table", caption: "Estimates", columns: COLUMNS, rows: [["all", "slope", slope, 0.1]] });
const entry = (...blocks: ReportBlock[]): ReportEntry => ({
  id: "rep", name: "Weekly", datasetId: null, report: { title: "Weekly", sections: [{ title: "Fit", blocks }] },
});
function linkedBlock(ds: Dataset, slope: number): ReportBlock {
  const done = linkBlockToResult(snapshot(slope), result(ds, slope), 0);
  if ("error" in done) throw new Error(done.error);
  return done.block;
}
const rowsOf = (): unknown => (useApp.getState().reports[0].report.sections[0].blocks[0] as { rows: unknown }).rows;

beforeEach(() => {
  vi.clearAllMocks();
  usePendingOps.setState({ ops: [] });
  vi.mocked(reportExport).mockResolvedValue({ warnings: [], warningCount: 0 });
});

function setup(block: ReportBlock, ds: Dataset, results: AnalysisResult[]) {
  useApp.setState({ reports: [entry(block)], openReportId: "rep", datasets: [ds], analysisResults: results, editableFigures: [] });
}

describe("linked report blocks in the viewer", () => {
  it("a snapshot block offers Link and shows no badge; it stays a snapshot by default", () => {
    setup(snapshot(2), dataset(3), [result(dataset(3), 2)]);
    render(<ReportPanel />);
    expect(screen.getByRole("button", { name: "Link to source…" })).toBeInTheDocument();
    expect(screen.queryByText(/⛓/)).toBeNull();
    expect(screen.queryByText("Refresh all")).toBeNull();
  });

  it("shows linked, then stale after the data changes, then refreshes after recompute", async () => {
    const ds = dataset(3);
    setup(linkedBlock(ds, 2), ds, [result(ds, 2)]);
    render(<ReportPanel />);
    expect(screen.getByText("⛓ linked")).toBeInTheDocument();

    // data changed, analysis not rerun: stale, Refresh refused (disabled)
    const changed = dataset(5);
    useApp.setState({ datasets: [changed] });
    await waitFor(() => expect(screen.getByText("⛓ stale")).toBeInTheDocument());
    expect(screen.getByTestId("report-link-reason")).toHaveTextContent(/run the analysis again/);
    expect(screen.getByRole("button", { name: "Refresh block" })).toBeDisabled();

    // recompute: the result now carries new numbers for the new data
    useApp.setState({ analysisResults: [result(changed, 4)] });
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh block" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Refresh block" }));
    await waitFor(() => expect(screen.getByText("⛓ linked")).toBeInTheDocument());
    expect(rowsOf()).toEqual([["all", "slope", 4, 0.1]]);
  });

  it("Refresh all pulls every behind block in one undo step", async () => {
    const ds = dataset(5);
    const b = linkedBlock(dataset(3), 2);
    useApp.setState({ reports: [entry(b, { ...b })], openReportId: "rep", datasets: [ds], analysisResults: [result(ds, 4)], editableFigures: [] });
    render(<ReportPanel />);
    await userEvent.click(screen.getByRole("button", { name: "Refresh all" }));
    await waitFor(() => expect(screen.getAllByText("⛓ linked")).toHaveLength(2));
    const blocks = useApp.getState().reports[0].report.sections[0].blocks as { rows: unknown }[];
    expect(blocks.map((x) => x.rows)).toEqual([[["all", "slope", 4, 0.1]], [["all", "slope", 4, 0.1]]]);
  });

  it("a deleted source shows source missing and keeps the last snapshot", async () => {
    const ds = dataset(3);
    setup(linkedBlock(ds, 2), ds, []);
    render(<ReportPanel />);
    expect(screen.getByText("⛓ source missing")).toBeInTheDocument();
    expect(screen.getByText("last snapshot kept")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh block" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Refresh all" }));
    expect(rowsOf()).toEqual([["all", "slope", 2, 0.1]]);
  });

  it("unlink returns to a plain snapshot", async () => {
    const ds = dataset(3);
    setup(linkedBlock(ds, 2), ds, [result(ds, 2)]);
    render(<ReportPanel />);
    await userEvent.click(screen.getByRole("button", { name: "Unlink" }));
    expect("link" in useApp.getState().reports[0].report.sections[0].blocks[0]).toBe(false);
  });

  it("export uses what is shown by default, and refreshes first only when asked", async () => {
    const ds = dataset(5);
    useApp.setState({ reports: [entry(linkedBlock(dataset(3), 2))], openReportId: "rep", datasets: [ds], analysisResults: [result(ds, 4)], editableFigures: [] });
    render(<ReportPanel />);
    expect(screen.getByRole("checkbox", { name: /Refresh linked blocks before export/ })).not.toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "HTML" }));
    await waitFor(() => expect(vi.mocked(reportExport).mock.calls).toHaveLength(1));
    expect(JSON.stringify(vi.mocked(reportExport).mock.calls[0][0])).toContain("[\"all\",\"slope\",2,0.1]");
    expect(rowsOf()).toEqual([["all", "slope", 2, 0.1]]);

    await userEvent.click(screen.getByRole("checkbox", { name: /Refresh linked blocks before export/ }));
    await userEvent.click(screen.getByRole("button", { name: "HTML" }));
    await waitFor(() => expect(vi.mocked(reportExport).mock.calls).toHaveLength(2));
    expect(JSON.stringify(vi.mocked(reportExport).mock.calls[1][0])).toContain("[\"all\",\"slope\",4,0.1]");
    expect(rowsOf()).toEqual([["all", "slope", 4, 0.1]]); // shown == exported
  });

  it("export with refresh keeps the snapshot of a block whose source is missing", async () => {
    const ds = dataset(3);
    setup(linkedBlock(ds, 2), ds, []);
    render(<ReportPanel />);
    await userEvent.click(screen.getByRole("checkbox", { name: /Refresh linked blocks before export/ }));
    await userEvent.click(screen.getByRole("button", { name: "HTML" }));
    await waitFor(() => expect(vi.mocked(reportExport).mock.calls).toHaveLength(1));
    expect(JSON.stringify(vi.mocked(reportExport).mock.calls[0][0])).toContain("[\"all\",\"slope\",2,0.1]");
  });

  it("a figure block links to an editable figure and goes stale when its data changes", () => {
    const ds = dataset(3);
    const doc = createFigureDocument({ id: "fig1", name: "My Figure", datasetId: "s", view: defaultPlotView() });
    const block: ReportBlock = { type: "figure", name: "fig", spec: { fmt: "svg" },
      link: { kind: "figure", id: "fig1", pulled: figureKey(doc, [ds])!, name: "My Figure" } };
    useApp.setState({ reports: [entry(block)], openReportId: "rep", datasets: [ds], analysisResults: [], editableFigures: [doc] });
    const { rerender } = render(<ReportPanel />);
    expect(screen.getByText("⛓ linked")).toBeInTheDocument();
    useApp.setState({ datasets: [dataset(9)] });
    rerender(<ReportPanel />);
    expect(screen.getByText("⛓ stale")).toBeInTheDocument();
    expect(within(screen.getByTestId("report-link-bar")).getByRole("button", { name: "Refresh block" })).toBeEnabled();
    useApp.setState({ editableFigures: [] });
    rerender(<ReportPanel />);
    expect(screen.getByText("⛓ source missing")).toBeInTheDocument();
  });
});
