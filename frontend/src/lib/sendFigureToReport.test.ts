// "Send figure to report…" (P3.6 frontend half). The load-bearing claim is
// that a report figure block carries EXACTLY the spec "Export figure…" posts
// for the same choices — pinned here by running BOTH real commands against
// the same store and comparing the export's wire body with the block's spec,
// on the canonical-document route AND the live-view fallback route. Plus the
// store half: target resolution, one undo step, and the deleted-target race.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { askParams } from "../components/overlays/ParamDialog";
import { exportFigure } from "./api/figures";
import { runExportFigureCommand } from "./exportFigureCommand";
import { createFigureDocument } from "./figureDocument";
import { defaultPlotView, type PlotWindow } from "./plotview";
import type { ReportEntry, ReportFigureBlock } from "./report";
import {
  NEW_REPORT,
  SEND_UNDO_LABEL,
  addFigureToReport,
  reportChoices,
  runSendFigureToReportCommand,
} from "./sendFigureToReport";
import { useToasts } from "../store/toasts";
import { useApp } from "../store/useApp";

vi.mock("./api/figures", () => ({ exportFigure: vi.fn().mockResolvedValue(undefined) }));
// ONE mock fn behind both import paths: "Export figure…" asks through the
// ParamDialog re-export, the send command through its store home.
const { ask } = vi.hoisted(() => ({ ask: vi.fn() }));
vi.mock("../components/overlays/ParamDialog", () => ({ askParams: ask }));
vi.mock("../store/paramDialog", () => ({ askParams: ask }));

const DS = "d1";

function win(over: Partial<PlotWindow>): PlotWindow {
  return {
    id: "w1",
    kind: "plot",
    title: "Window 1",
    datasetId: DS,
    geometry: { x: 0, y: 0, w: 400, h: 300 },
    z: 0,
    winState: "normal",
    view: defaultPlotView(),
    bg: "theme",
    linkGroup: null,
    pinned: false,
    ...over,
  };
}

const existing = (id: string, name: string): ReportEntry => ({
  id,
  name,
  datasetId: null,
  report: { title: name, sections: [{ title: "Fit results", blocks: [{ type: "text", text: "Model: Linear" }] }] },
});

/** The Send dialog's answers. */
function sendParams(over: Record<string, unknown> = {}) {
  return { target: NEW_REPORT, caption: "Hall sweep", fmt: "svg", style: "aps", greyscale: true, ...over };
}

function figureBlocks(reportId: string): ReportFigureBlock[] {
  const entry = useApp.getState().reports.find((r) => r.id === reportId);
  return (entry?.report.sections ?? []).flatMap((s) =>
    s.blocks.filter((b): b is ReportFigureBlock => b.type === "figure"),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(exportFigure).mockResolvedValue(undefined);
  useToasts.setState({ toasts: [] });
  useApp.setState({
    datasets: [
      {
        id: DS,
        name: "scan.dat",
        data: {
          time: [0, 1, 2],
          values: [
            [1, 10],
            [2, Number.NaN],
            [3, 30],
          ],
          labels: ["A", "B"],
          units: ["u", "v"],
          metadata: {},
        },
      },
    ],
    activeId: DS,
    xKey: null,
    yKeys: [0, 1],
    y2Keys: null,
    groupKey: null,
    xScale: "linear",
    yScale: "log",
    xFmt: { mode: "auto", digits: 2 },
    yFmt: { mode: "sci", digits: 3 },
    y2Fmt: null,
    xStep: null,
    yStep: null,
    seriesStyles: {},
    seriesLabels: { 1: "renamed B" },
    seriesOrder: null,
    hiddenChannels: [],
    xLim: [0, 2],
    yLim: null,
    showGrid: true,
    showAxisBox: false,
    plotTitle: "Hall sweep",
    xAxisLabel: "Field",
    yAxisLabel: "",
    plotWindows: [],
    focusedWindowId: null,
    reports: [],
    openReportId: null,
    history: [],
    future: [],
    status: "",
  });
});

/** A spec as the wire/.dwk sees it. */
const wire = (v: unknown) => JSON.parse(JSON.stringify(v)) as unknown;

/** Run the REAL "Export figure…" with the same choices the send made, and
 *  return its wire body as it would be serialized. */
async function exportBodyFor(fmt: string, style: string, greyscale: boolean) {
  const s = useApp.getState();
  vi.mocked(askParams).mockResolvedValueOnce({
    fmt, style, dpi: 300, greyscale, title: s.plotTitle, x_label: s.xAxisLabel, y_label: s.yAxisLabel,
  });
  await runExportFigureCommand(useApp.getState);
  const body = vi.mocked(exportFigure).mock.calls.at(-1)?.[0];
  expect(body).toBeDefined();
  return JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
}

describe("runSendFigureToReportCommand — the spec IS the Export figure… spec", () => {
  it("live-view route (no focused document): block.spec equals the export body", async () => {
    vi.mocked(askParams).mockResolvedValueOnce(sendParams());
    await runSendFigureToReportCommand(useApp.getState);
    const s = useApp.getState();
    expect(s.reports).toHaveLength(1);
    const [block] = figureBlocks(s.reports[0].id);
    // Compared AS SENT: the block keeps a structured clone (NaN stays NaN in
    // memory), so both sides go through the same JSON the wire and .dwk use.
    expect(wire(block.spec)).toEqual(await exportBodyFor("svg", "aps", true));
    // spot-check the choices really reached the spec, so the equality above
    // is not two empty specs agreeing
    expect(block.spec).toMatchObject({ fmt: "svg", style: "aps", greyscale: true, title: "Hall sweep" });
    // detached snapshot: not the store's own data arrays
    const values = (block.spec?.dataset as { values: number[][] }).values;
    expect(values).not.toBe(useApp.getState().datasets[0].data.values);
    expect(Number.isNaN(values[1][1])).toBe(true);
  });

  it("canonical-document route (focused grouped window): block.spec equals the export body", async () => {
    useApp.setState({ yKeys: [0], groupKey: 1 });
    const document = createFigureDocument({
      id: "figure-w1",
      name: "Window 1",
      datasetId: DS,
      view: defaultPlotView(),
      groupKey: 1,
    });
    useApp.setState({ plotWindows: [win({ document })], focusedWindowId: "w1" });
    vi.mocked(askParams).mockResolvedValueOnce(sendParams({ fmt: "png", style: "default", greyscale: false }));
    await runSendFigureToReportCommand(useApp.getState);
    const [block] = figureBlocks(useApp.getState().reports[0].id);
    const body = await exportBodyFor("png", "default", false);
    expect(body.group_col).toBe(1); // the document route really ran
    expect(wire(block.spec)).toEqual(body);
  });
});

describe("runSendFigureToReportCommand — targets, undo, failure", () => {
  it("a new report: named after the dataset, a Figures section, captioned, opened, ONE undo step", async () => {
    vi.mocked(askParams).mockResolvedValueOnce(sendParams({ caption: "  Fig. 1  " }));
    await runSendFigureToReportCommand(useApp.getState);
    const s = useApp.getState();
    const entry = s.reports[0];
    expect(entry.name).toBe("scan figures");
    expect(entry.datasetId).toBe(DS);
    expect(entry.report.sections.map((x) => x.title)).toEqual(["Figures"]);
    expect(figureBlocks(entry.id)[0]).toMatchObject({ type: "figure", name: "scan", caption: "Fig. 1" });
    expect(s.openReportId).toBe(entry.id);
    expect(s.history.map((h) => h.label)).toEqual([SEND_UNDO_LABEL]);
    s.undo();
    expect(useApp.getState().reports).toEqual([]);
  });

  it("an existing report: appended to a new Figures section after its analysis sections, one undo step", async () => {
    useApp.setState({ reports: [existing("rep-a", "Fit A"), existing("rep-b", "Fit B")], openReportId: "rep-b" });
    // The picker defaults to the report that is open in the viewer.
    vi.mocked(askParams).mockImplementationOnce(async (_title, fields) => {
      expect(fields.find((f) => f.key === "target")?.default).toBe("Fit B");
      return sendParams({ target: "Fit A" });
    });
    await runSendFigureToReportCommand(useApp.getState);
    const s = useApp.getState();
    const a = s.reports.find((r) => r.id === "rep-a");
    expect(a?.report.sections.map((x) => x.title)).toEqual(["Fit results", "Figures"]);
    expect(s.reports.find((r) => r.id === "rep-b")?.report).toEqual(existing("rep-b", "Fit B").report);
    expect(s.openReportId).toBe("rep-a");
    expect(s.history).toHaveLength(1);
    s.undo();
    expect(useApp.getState().reports.find((r) => r.id === "rep-a")).toEqual(existing("rep-a", "Fit A"));
  });

  it("names each figure uniquely within the target report (scan, scan-2, scan-3)", async () => {
    vi.mocked(askParams).mockResolvedValueOnce(sendParams());
    await runSendFigureToReportCommand(useApp.getState);
    const id = useApp.getState().reports[0].id;
    for (let k = 0; k < 2; k++) {
      vi.mocked(askParams).mockResolvedValueOnce(sendParams({ target: "scan figures" }));
      await runSendFigureToReportCommand(useApp.getState);
    }
    expect(useApp.getState().reports).toHaveLength(1);
    expect(figureBlocks(id).map((b) => b.name)).toEqual(["scan", "scan-2", "scan-3"]);
  });

  it("an info toast warns when the sent spec is large; a small one says nothing", async () => {
    vi.mocked(askParams).mockResolvedValueOnce(sendParams());
    await runSendFigureToReportCommand(useApp.getState);
    expect(useToasts.getState().toasts.some((t) => /MB of plotted data/.test(t.msg))).toBe(false);
    // ~6.5 MB estimated: 180k rows x (time + 2 channels) numbers x 12 B.
    const rows = 180_000;
    const time = Array.from({ length: rows }, (_, i) => i);
    useApp.setState({
      datasets: [
        {
          id: DS,
          name: "scan.dat",
          data: { time, values: time.map((t) => [t, 2 * t]), labels: ["A", "B"], units: ["u", "v"], metadata: {} },
        },
      ],
      xLim: null,
      yScale: "linear",
    });
    useToasts.setState({ toasts: [] });
    vi.mocked(askParams).mockResolvedValueOnce(sendParams());
    await runSendFigureToReportCommand(useApp.getState);
    const notice = useToasts.getState().toasts.find((t) => /MB of plotted data/.test(t.msg));
    expect(notice?.kind).toBe("info");
    expect(notice?.msg).toMatch(/report and the saved \.dwk grow/);
  });

  it("cancelling the dialog changes nothing", async () => {
    vi.mocked(askParams).mockResolvedValueOnce(null);
    await runSendFigureToReportCommand(useApp.getState);
    expect(useApp.getState().reports).toEqual([]);
    expect(useApp.getState().history).toEqual([]);
  });

  it("a target deleted before the send lands fails loudly and records nothing", () => {
    const block: ReportFigureBlock = { type: "figure", name: "scan", spec: { dataset: {} } };
    expect(() => addFigureToReport(useApp.getState, "rep-gone", block, "scan", DS)).toThrow(/deleted/);
    expect(useApp.getState().history).toEqual([]);
  });

  it("the deleted-target race surfaces as a failed-send toast through exportActive", async () => {
    useApp.setState({ reports: [existing("rep-a", "Fit A")] });
    vi.mocked(askParams).mockResolvedValueOnce(sendParams({ target: "Fit A" }));
    // The report disappears while the dataset resolves (after the dialog).
    const realResolve = useApp.getState().resolveDataset;
    useApp.setState({
      resolveDataset: async (id: string) => {
        useApp.setState({ reports: [] });
        return realResolve(id);
      },
    });
    try {
      await runSendFigureToReportCommand(useApp.getState);
    } finally {
      useApp.setState({ resolveDataset: realResolve });
    }
    expect(useApp.getState().reports).toEqual([]);
    expect(
      useToasts.getState().toasts.some((t) => t.kind === "danger" && /^send failed: .*deleted/.test(t.msg)),
    ).toBe(true);
  });
});

describe("reportChoices", () => {
  it("uses plain names, disambiguating duplicates and a report literally called 'New report'", () => {
    const labels = reportChoices([
      existing("rep-1", "Fit"),
      existing("rep-2", "Fit"),
      existing("rep-3", NEW_REPORT),
      existing("rep-4", "Peaks"),
    ]);
    expect(labels).toEqual(["Fit (rep-1)", "Fit (rep-2)", `${NEW_REPORT} (rep-3)`, "Peaks"]);
    expect(new Set([NEW_REPORT, ...labels]).size).toBe(5);
  });

  it("a plain name equal to another report's id-suffixed label is disambiguated too (second pass)", () => {
    const labels = reportChoices([existing("rep-3", "X"), existing("rep-4", "X"), existing("rep-9", "X (rep-3)")]);
    expect(labels).toEqual(["X (rep-3)", "X (rep-4)", "X (rep-3) (rep-9)"]);
  });

  it("falls back to position numbers when names still collide after both passes", () => {
    const labels = reportChoices([
      existing("a", "N"),
      existing("b", "N"),
      existing("c", "N (a)"),
      existing("d", "N (a) (c)"),
    ]);
    expect(new Set(labels).size).toBe(4);
    expect(labels.every((l, i) => l.startsWith(`${i + 1}. `))).toBe(true);
  });
});
