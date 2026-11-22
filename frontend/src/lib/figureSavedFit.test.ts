// A saved DISPLAY fit curve in document-only exports (a Figure Page panel, a
// batch / Library PDF): fetched in full by resultId (evicted: the model
// evaluated at the fitted x) instead of being left out with the notice.
// plans/LARGE_PAYLOAD_PLAN.md "Document-only exports".

import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportFigureBatch } from "./api/figureBatch";
import { fitBands } from "./api/fitStats";
import { HttpError, postJSON } from "./api/http";
import { downloadBatchFigures } from "./batchFigureExport";
import { createFigureDocument, type FigureDocument } from "./figureDocument";
import { captureFit } from "./figureOverlays";
import { withFullSavedFit } from "./figureSavedFit";
import { buildFigureSpecFromDocument } from "./figureSpec";
import { defaultPlotView } from "./plotview";
import type { FigureSpec } from "./api/figures";
import type { FitOverlay } from "./types";
import { useApp } from "../store/useApp";
import { panelFigure } from "../components/workshops/figurepage/panelResolve";
import { T2, t1r1t2r2 } from "../test/ownXFixture";

vi.mock("./api/fitStats", () => ({ fitBands: vi.fn() }));
vi.mock("./api/figureBatch", () => ({ exportFigureBatch: vi.fn() }));
vi.mock("./api/http", async (orig) => ({ ...(await orig<typeof import("./api/http")>()), postJSON: vi.fn() }));

const SHEET = t1r1t2r2();
const FULL_Y = [7, 8, 9, 10];
// The thinned picture: rows 1 and 2 sit between display rows (undefined).
const DISPLAY: FitOverlay = {
  datasetId: "own", binding: { yKey: 2, xKey: 1 }, y: [7, undefined as never, undefined as never, 10],
  full: { resultId: "rid", model: "Linear", params: [1, 2], rows: [0, 1, 2, 3], x: T2 },
};

function savedDoc(): FigureDocument {
  const overlays = captureFit(DISPLAY, SHEET)!;
  return createFigureDocument({
    id: "fig-1", name: "R vs T", datasetId: "own", view: { ...defaultPlotView(), yKeys: [0, 2] }, overlays,
  });
}

const fitPoints = (spec: FigureSpec): number[][] => {
  const k = spec.dataset.labels.indexOf("fit");
  if (k < 0) return [];
  const x = (r: number) => (spec.x_key == null ? spec.dataset.time[r] : spec.dataset.values[r][spec.x_key as number]);
  return spec.dataset.values.flatMap((row, r) => (Number.isFinite(row[k]) ? [[x(r), row[k]]] : []));
};

beforeEach(() => {
  vi.mocked(postJSON).mockReset();
  vi.mocked(fitBands).mockReset();
  vi.mocked(exportFigureBatch).mockReset();
  useApp.setState(useApp.getInitialState(), true);
  useApp.setState({ datasets: [SHEET], activeId: "own", editableFigures: [] });
});

describe("a saved display fit in a document-only export", () => {
  it("the sync builder alone still leaves it out, with the notice", () => {
    const dropped = vi.fn();
    const spec = buildFigureSpecFromDocument(savedDoc(), SHEET, "x", { onDroppedOverlays: dropped });
    expect(dropped).toHaveBeenCalledTimes(1);
    expect(fitPoints(spec)).toEqual([]);
  });

  it("withFullSavedFit fetches the full curve by id and the builder draws it all", async () => {
    vi.mocked(postJSON).mockResolvedValue({ yFit: FULL_Y });
    const dropped = vi.fn();
    const doc = await withFullSavedFit(savedDoc(), SHEET);
    const spec = buildFigureSpecFromDocument(doc, SHEET, "x", { onDroppedOverlays: dropped });
    expect(dropped).not.toHaveBeenCalled();
    expect(fitPoints(spec)).toEqual([[40, 7], [10, 8], [30, 9], [20, 10]]);
    expect(vi.mocked(postJSON).mock.calls).toEqual([["/api/fitting/curve", { result_id: "rid" }]]);
  });

  it("an evicted id (409) evaluates the model at the panel's x", async () => {
    vi.mocked(postJSON).mockRejectedValue(new HttpError(409, "unknown_fit_result"));
    vi.mocked(fitBands).mockResolvedValue({ yFit: FULL_Y } as never);
    const doc = await withFullSavedFit(savedDoc(), SHEET);
    expect(fitPoints(buildFigureSpecFromDocument(doc, SHEET, "x"))).toHaveLength(4);
    expect(vi.mocked(fitBands).mock.calls[0]![0]).toMatchObject({ model: "Linear", params: [1, 2], x: T2 });
  });

  it("fails closed: a failed fetch, a stale fit or another dataset's rows return the document unchanged", async () => {
    vi.mocked(postJSON).mockRejectedValue(new HttpError(500, "boom"));
    const doc = savedDoc();
    expect(await withFullSavedFit(doc, SHEET)).toBe(doc);
    expect(await withFullSavedFit(doc, SHEET, ["own"])).toBe(doc);
    const edited = { ...SHEET, excludedRows: [1] };
    vi.mocked(postJSON).mockResolvedValue({ yFit: FULL_Y });
    const dropped = vi.fn();
    buildFigureSpecFromDocument(await withFullSavedFit(doc, edited), edited, "x", { onDroppedOverlays: dropped });
    expect(dropped).toHaveBeenCalledTimes(1); // rows key changed: still left out, never re-aligned
  });

  it("a Figure Page panel draws the full curve", async () => {
    vi.mocked(postJSON).mockResolvedValue({ yFit: FULL_Y });
    const doc = savedDoc();
    useApp.setState({ editableFigures: [doc] });
    const panel = await panelFigure({ kind: "figure", id: doc.id, name: doc.name });
    expect(fitPoints(panel!)).toEqual([[40, 7], [10, 8], [30, 9], [20, 10]]);
  });

  it("a batch / Library PDF draws the full curve", async () => {
    vi.mocked(postJSON).mockResolvedValue({ yFit: FULL_Y });
    await downloadBatchFigures([savedDoc()], [SHEET], { format: "pdf", archiveName: "x", multipage: true });
    const specs = vi.mocked(exportFigureBatch).mock.calls[0]![0] as FigureSpec[];
    expect(fitPoints(specs[0]!)).toEqual([[40, 7], [10, 8], [30, 9], [20, 10]]);
  });
});
