// F4.2c (a) for "Send figure to report…": both send paths (the focused plot
// and the Library's saved figure) ask "greyed or omitted?" when the figure has
// masked rows, never otherwise, and the block's spec draws what was chosen.
// Driven through the real parameter-dialog store; every wait is on dialog
// STATE, never on a mock having been called.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EXCLUDED_GREY_OPTION, EXCLUDED_OMIT_OPTION } from "./excludedRowsChoice";
import { createFigureDocument } from "./figureDocument";
import { defaultPlotView } from "./plotview";
import type { FigureSpec } from "./api/figures";
import type { ReportFigureBlock } from "./report";
import { NEW_REPORT, runSendEditableFigureToReport, runSendFigureToReportCommand } from "./sendFigureToReport";
import type { DataStruct, Dataset } from "./types";
import { useParamDialog } from "../store/paramDialog";
import { usePendingOps } from "../store/pendingOps";
import { useApp } from "../store/useApp";

const DATA: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[1], [2], [3], [4]],
  labels: ["M"],
  units: ["emu"],
  metadata: {},
};

function seed(excludedRows?: number[]) {
  const ds: Dataset = { id: "d1", name: "scan.dat", data: DATA, ...(excludedRows ? { excludedRows } : {}) };
  useApp.setState({
    datasets: [ds],
    activeId: "d1",
    xKey: null,
    yKeys: [0],
    hiddenChannels: [],
    plotWindows: [],
    focusedWindowId: null,
    reports: [],
    openReportId: null,
    editableFigures: [
      createFigureDocument({ id: "fig1", name: "Loop", datasetId: "d1", view: { ...defaultPlotView(), yKeys: [0] } }),
    ],
    status: "",
  });
}

async function answer(title: string, values: Record<string, string | number | boolean> | null) {
  await vi.waitFor(() => expect(useParamDialog.getState().title).toBe(title));
  const { resolve, fields, close } = useParamDialog.getState();
  close();
  resolve!(values === null ? null : { ...Object.fromEntries(fields.map((f) => [f.key, f.default])), ...values });
}

/** The sent block's spec (a report stores it untyped). */
function sentSpec(): FigureSpec | null {
  const [report] = useApp.getState().reports;
  const blocks = (report?.report.sections ?? []).flatMap((s) => s.blocks);
  const spec = blocks.find((b): b is ReportFigureBlock => b.type === "figure")?.spec;
  return spec ? (spec as unknown as FigureSpec) : null;
}

const SENDS = [
  ["the focused plot", () => runSendFigureToReportCommand(useApp.getState)],
  ["a saved Library figure", () => runSendEditableFigureToReport(useApp.getState, "fig1")],
] as const;

beforeEach(() => {
  usePendingOps.setState({ ops: [] });
  useParamDialog.getState().close();
  useApp.getState().setPref("excludedDisplay", "grey");
});

afterEach(() => {
  useApp.setState({ datasets: [], activeId: null, reports: [], editableFigures: [] });
});

describe.each(SENDS)("Send to report from %s honours the excluded-rows choice", (_name, send) => {
  it("never asks without excluded rows", async () => {
    seed();
    const run = send();
    await answer("Send figure to report", { target: NEW_REPORT });
    await run;
    expect(useParamDialog.getState().title).toBeNull();
    expect(sentSpec()?.dataset.time).toEqual([0, 1, 2, 3]);
  });

  it("greyed: the kept rows plus one grey '(excluded)' companion", async () => {
    seed([1]);
    const run = send();
    await answer("Send figure to report", { target: NEW_REPORT });
    await answer("Excluded rows", { mode: EXCLUDED_GREY_OPTION });
    await run;
    const spec = sentSpec()!;
    expect(spec.dataset.labels).toEqual(["M", "M (excluded)"]);
    expect(spec.y_keys).toEqual([0, 1]);
    expect(spec.dataset.time).toEqual([0, 2, 3, 1]); // kept rows first, then the dropped one
  });

  it("omitted: only the kept rows", async () => {
    seed([1]);
    const run = send();
    await answer("Send figure to report", { target: NEW_REPORT });
    await answer("Excluded rows", { mode: EXCLUDED_OMIT_OPTION });
    await run;
    const spec = sentSpec()!;
    expect(spec.dataset.time).toEqual([0, 2, 3]);
    expect(spec.y_keys).toEqual([0]);
  });

  it("dismissing the question adds nothing and says the send was cancelled", async () => {
    seed([1]);
    const run = send();
    await answer("Send figure to report", { target: NEW_REPORT });
    await answer("Excluded rows", null);
    await run;
    expect(useApp.getState().reports).toEqual([]);
    expect(useApp.getState().status).toBe("send cancelled");
  });
});

describe.each(SENDS)("Send to report from %s draws the Preferences default trace", (_name, send) => {
  afterEach(() => useApp.getState().setPref("defaultTrace", "Line"));

  it("an unstyled series sends as the canvas draws it: markers at 5 px, no line", async () => {
    seed();
    useApp.getState().setPref("defaultTrace", "Scatter");
    const run = send();
    await answer("Send figure to report", { target: NEW_REPORT });
    await run;
    expect(sentSpec()?.series_styles?.[0]).toMatchObject({ width: 0, marker: true, marker_size: 5 });
  });
});
