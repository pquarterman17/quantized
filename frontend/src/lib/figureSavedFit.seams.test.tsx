// A saved DISPLAY fit curve through the two seams that still built the document
// synchronously: "Add to Report…" from the Library (`runSendEditableFigureToReport`)
// and the Figure Builder (preview hook + Export). Each fetches the full curve
// (`withFullSavedFit`) and fails closed to the builder's "left out" behaviour.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportFigure, type FigureSpec } from "./api/figures";
import { HttpError, postJSON } from "./api/http";
import { createFigureDocument, type FigureDocument } from "./figureDocument";
import { captureFit } from "./figureOverlays";
import { defaultPlotView } from "./plotview";
import type { ReportFigureBlock } from "./report";
import { NEW_REPORT, runSendEditableFigureToReport } from "./sendFigureToReport";
import type { FitOverlay } from "./types";
import { useParamDialog } from "../store/paramDialog";
import { usePendingOps } from "../store/pendingOps";
import { useApp } from "../store/useApp";
import { exportPreviewFigure } from "../components/workshops/figurebuilder/previewExport";
import { useFullSavedFitDocument } from "../components/workshops/figurebuilder/useFullSavedFitDocument";
import { T2, t1r1t2r2 } from "../test/ownXFixture";

vi.mock("./api/figures", async (orig) => ({ ...(await orig<typeof import("./api/figures")>()), exportFigure: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./api/http", async (orig) => ({ ...(await orig<typeof import("./api/http")>()), postJSON: vi.fn() }));
vi.mock("./api/fitStats", () => ({ fitBands: vi.fn().mockRejectedValue(new Error("no backend")) }));

const SHEET = t1r1t2r2();
const FULL_Y = [7, 8, 9, 10];
const DISPLAY: FitOverlay = {
  datasetId: "own", binding: { yKey: 2, xKey: 1 }, y: [7, undefined as never, undefined as never, 10],
  full: { resultId: "rid", model: "Linear", params: [1, 2], rows: [0, 1, 2, 3], x: T2 },
};
const savedDoc = (): FigureDocument =>
  createFigureDocument({ id: "fig-1", name: "R vs T", datasetId: "own", view: { ...defaultPlotView(), yKeys: [0, 2] }, overlays: captureFit(DISPLAY, SHEET)! });

const hasFit = (spec: FigureSpec | null | undefined): boolean => !!spec?.dataset.labels.includes("fit");

beforeEach(() => {
  vi.mocked(postJSON).mockReset();
  vi.mocked(exportFigure).mockClear();
  usePendingOps.setState({ ops: [] });
  useParamDialog.getState().close();
  useApp.setState(useApp.getInitialState(), true);
  useApp.setState({ datasets: [SHEET], activeId: "own", editableFigures: [savedDoc()], reports: [], openReportId: null, status: "" });
});

async function sendSaved(): Promise<FigureSpec | null> {
  const run = runSendEditableFigureToReport(useApp.getState, "fig-1");
  await vi.waitFor(() => expect(useParamDialog.getState().title).toBe("Send figure to report"));
  const { resolve, fields, close } = useParamDialog.getState();
  close();
  resolve!({ ...Object.fromEntries(fields.map((f) => [f.key, f.default])), target: NEW_REPORT });
  await run;
  const blocks = (useApp.getState().reports[0]?.report.sections ?? []).flatMap((s) => s.blocks);
  const block = blocks.find((b): b is ReportFigureBlock => b.type === "figure");
  return block ? (block.spec as unknown as FigureSpec) : null;
}

describe("Add to Report from a saved figure with a display fit", () => {
  it("sends the FULL fit curve", async () => {
    vi.mocked(postJSON).mockResolvedValue({ yFit: FULL_Y });
    const spec = await sendSaved();
    expect(hasFit(spec)).toBe(true);
    expect(vi.mocked(postJSON).mock.calls).toEqual([["/api/fitting/curve", { result_id: "rid" }]]);
  });

  it("fails closed: an unreadable curve leaves the fit out, the figure is still sent", async () => {
    vi.mocked(postJSON).mockRejectedValue(new HttpError(500, "boom"));
    const spec = await sendSaved();
    expect(spec).not.toBeNull();
    expect(hasFit(spec)).toBe(false);
  });
});

describe("Figure Builder: preview hook and Export", () => {
  it("the preview waits for the full curve, saying so meanwhile", async () => {
    let release: (v: unknown) => void = () => {};
    let asked = false;
    vi.mocked(postJSON).mockImplementation(() => new Promise((r) => { asked = true; release = r; }));
    const doc = savedDoc();
    const { result } = renderHook(() => useFullSavedFitDocument(doc, SHEET, undefined));
    expect(result.current.doc).toBe(doc);
    expect(result.current.note).toMatch(/loading/i);
    await act(async () => { await vi.waitFor(() => expect(asked).toBe(true)); release({ yFit: FULL_Y }); });
    await waitFor(() => expect(result.current.note).toBeNull());
    expect(result.current.doc?.overlays?.fit?.full).toBeUndefined();
    expect(result.current.doc?.overlays?.fit?.y).toEqual(FULL_Y);
  });

  it("a failed fetch keeps the document and says the fit is left out", async () => {
    vi.mocked(postJSON).mockRejectedValue(new HttpError(500, "boom"));
    const doc = savedDoc();
    const { result } = renderHook(() => useFullSavedFitDocument(doc, SHEET, undefined));
    await waitFor(() => expect(result.current.note).toMatch(/left out/));
    expect(result.current.doc).toBe(doc);
  });

  it("a document with no saved display fit costs nothing", () => {
    const plain = createFigureDocument({ id: "p", name: "p", datasetId: "own", view: defaultPlotView() });
    const { result } = renderHook(() => useFullSavedFitDocument(plain, SHEET, undefined));
    expect(result.current).toEqual({ doc: plain, note: null });
    expect(postJSON).not.toHaveBeenCalled();
  });

  it("Export posts the full curve", async () => {
    vi.mocked(postJSON).mockResolvedValue({ yFit: FULL_Y });
    const document = savedDoc();
    await exportPreviewFigure({
      canonicalDocument: document, canonicalReadiness: { state: "ready", data: SHEET.data, spec: {} as FigureSpec },
      canonicalDataset: SHEET, spec: null, legacyState: {} as never, frozenData: null, active: SHEET,
      fmt: "svg", dpi: 300, autoSeriesStyles: false, setStatus: vi.fn(),
    });
    const body = vi.mocked(exportFigure).mock.calls.at(-1)?.[0] as unknown as FigureSpec;
    expect(hasFit(body)).toBe(true);
  });
});
