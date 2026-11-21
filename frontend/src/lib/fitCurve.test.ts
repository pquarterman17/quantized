// P4 phase 2: display-curve fits (lib/fitCurve.ts) -- the overlay column, the
// full-resolution accessors (by id, and the eviction fallback), the band's
// obsVar by id, and a saved figure's display section round trip.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitBands, type BandsResult } from "./api/fitStats";
import { restoreGapRows } from "./api/finitePairs";
import { HttpError, postJSON } from "./api/http";
import { captureFit, fitFromDocument, sanitizeFigureOverlays } from "./figureOverlays";
import {
  FIT_DISPLAY_MIN_POINTS,
  FIT_DISPLAY_POINTS,
  displayOverlayY,
  fitBandsFor,
  fitOverlayColumn,
  fitRowsOf,
  fitTransport,
  fullFitCurve,
  fullFitOverlay,
  fullFitResult,
  withCurveSource,
} from "./fitCurve";
import { expandToFull } from "./rowstate";
import type { CalcResult, Dataset, FitOverlay } from "./types";

vi.mock("./api/fitStats", () => ({ fitBands: vi.fn() }));
vi.mock("./api/http", async (orig) => ({ ...(await orig<typeof import("./api/http")>()), postJSON: vi.fn() }));

const bands = (yFit: (number | null)[]): BandsResult => ({ yFit, ciLo: [], ciHi: [], piLo: [], piHi: [], level: 0.95 });

// Eight dataset rows; row 2 is excluded (not an analysis row) and analysis
// pair 3 (dataset row 4) is a gap pair (no finite Y), so the fit ran on six
// points at dataset rows [0, 1, 3, 5, 6, 7].
const N = 8;
const KEPT = [0, 1, 3, 4, 5, 6, 7];
const PAIRS = { keep: [0, 1, 2, 4, 5, 6], n: 7 };
const ROWS = fitRowsOf(PAIRS.keep, KEPT, N);
const X = [0, 1, 3, 5, 6, 7];
const Y_FIT = [10, 11, 13, 15, 16, 17];
const Y = [10.5, 10.5, 13.5, 14.5, 16.5, 16.5];
// The server's display: fit points 0, 2 and 5 (both ends kept).
const DISPLAY_RESULT: CalcResult = {
  params: [1, 10], nFree: 2, chiSqRed: 0.25, errorsScaled: true, resultId: "rid",
  yFitDisplay: { rows: [0, 2, 5], y: [10, 13, 17] },
};
const display = () => withCurveSource(DISPLAY_RESULT, "Linear", X, ROWS);

beforeEach(() => {
  vi.mocked(postJSON).mockReset();
  vi.mocked(fitBands).mockReset();
});

describe("fitTransport", () => {
  it("asks for a display curve only above the threshold", () => {
    expect(fitTransport(FIT_DISPLAY_MIN_POINTS)).toEqual({ return_residuals: false });
    expect(fitTransport(FIT_DISPLAY_MIN_POINTS + 1)).toEqual({ return_residuals: false, display_points: FIT_DISPLAY_POINTS });
  });
});

describe("the overlay column", () => {
  it("draws the display rows, spans the rest of the fit, and is null off it", () => {
    expect(ROWS).toEqual([0, 1, 3, 5, 6, 7]);
    const y = displayOverlayY({ rows: [0, 2, 5], y: [10, null, 17] }, PAIRS, KEPT, N);
    // Row 2 excluded (null), row 4 a gap pair and row 3 a non-finite value
    // (NaN, as restoreGapRows writes them), rows 1/5/6 between display rows.
    expect(y).toEqual([10, undefined, null, Number.NaN, Number.NaN, undefined, undefined, 17]);
    expect(y[1]).toBeUndefined(); // uPlot draws across undefined
  });

  it("is the pre-phase-2 overlay for a result with its full yFit", () => {
    const full = { params: [1, 10], yFit: Y_FIT };
    const old = expandToFull(restoreGapRows(Y_FIT, PAIRS), KEPT, N);
    expect(fitOverlayColumn(full, PAIRS, KEPT, N)).toEqual({ y: old });
  });
});

describe("full resolution", () => {
  it("fetches the curve by id once, and the dense overlay equals the old path exactly", async () => {
    vi.mocked(postJSON).mockResolvedValue({ yFit: Y_FIT });
    const r = display();
    const col = fitOverlayColumn(r, PAIRS, KEPT, N)!;
    const overlay: FitOverlay = { datasetId: "d", binding: { yKey: 0, xKey: null }, ...col, curveFit: true };
    const dense = await fullFitOverlay(overlay);
    expect(dense.y).toEqual(expandToFull(restoreGapRows(Y_FIT, PAIRS), KEPT, N));
    expect(dense.full).toBeUndefined();
    expect(dense.curveFit).toBe(true);
    const again = await fullFitResult(r, Y);
    expect(again.yFit).toEqual(Y_FIT);
    expect(again.residuals).toEqual(Y.map((v, i) => v - Y_FIT[i]!));
    expect(vi.mocked(postJSON).mock.calls).toEqual([["/api/fitting/curve", { result_id: "rid" }]]);
    expect(fitBands).not.toHaveBeenCalled();
  });

  it("falls back once on a 409: the model evaluated at the fit's own x", async () => {
    vi.mocked(postJSON).mockRejectedValue(new HttpError(409, "unknown_fit_result"));
    vi.mocked(fitBands).mockResolvedValue(bands(Y_FIT));
    await expect(fullFitCurve(display().fitCurve as never)).resolves.toEqual(Y_FIT);
    expect(vi.mocked(fitBands).mock.calls).toEqual([[
      { model: "Linear", params: [1, 10], covar: null, x: X, n_points: 6, n_free: 2 },
    ]]);
  });

  it("refuses a curve that does not match the fitted rows, and does not cache the failure", async () => {
    vi.mocked(postJSON).mockResolvedValueOnce({ yFit: [1, 2] }).mockResolvedValueOnce({ yFit: Y_FIT });
    const src = display().fitCurve as never;
    await expect(fullFitCurve(src)).rejects.toThrow(/does not match/);
    await expect(fullFitCurve(src)).resolves.toEqual(Y_FIT);
  });

  it("leaves a result or overlay that is not a display curve alone", async () => {
    const full = { params: [1], yFit: Y_FIT };
    await expect(fullFitResult(full, Y)).resolves.toBe(full);
    const overlay: FitOverlay = { datasetId: "d", binding: { yKey: 0, xKey: null }, y: [1, 2] };
    await expect(fullFitOverlay(overlay)).resolves.toBe(overlay);
    expect(postJSON).not.toHaveBeenCalled();
  });
});

describe("fitBandsFor (obsVar by id)", () => {
  const req = { model: "Linear", params: [1, 10], covar: null, x: [0, 7], n_points: 6, n_free: 2, mse: 0.3 };
  const weighted = { x: X, dy: [1, 1, 2, 2, 1, 1] };

  it("sends the id, not the per-point arrays", async () => {
    vi.mocked(fitBands).mockResolvedValue(bands([1, 2]));
    await fitBandsFor(req, display(), weighted);
    expect(vi.mocked(fitBands).mock.calls).toEqual([[{ ...req, result_id: "rid" }, undefined]]);
  });

  it("on a 409 resends the fit's own weights and s² once", async () => {
    vi.mocked(fitBands).mockRejectedValueOnce(new HttpError(409, "unknown_fit_result")).mockResolvedValueOnce(bands([1, 2]));
    await fitBandsFor(req, display(), weighted);
    expect(vi.mocked(fitBands).mock.calls[1]).toEqual([{ ...req, x_data: X, obs_dy: weighted.dy, obs_scale: 0.25 }, undefined]);
    expect(fitBands).toHaveBeenCalledTimes(2);
  });

  it("posts an unweighted or a full result's request as is", async () => {
    vi.mocked(fitBands).mockResolvedValue(bands([1, 2]));
    await fitBandsFor(req, display(), { x: X });
    await fitBandsFor(req, { params: [1, 10] }, weighted);
    expect(vi.mocked(fitBands).mock.calls).toEqual([[req, undefined], [req, undefined]]);
  });
});

describe("a saved figure's display curve (workspace round trip)", () => {
  const DS: Dataset = {
    id: "d", name: "d.csv",
    data: { time: [0, 1, 2, 3, 4, 5, 6, 7], values: [[1], [1], [1], [1], [1], [1], [1], [1]], labels: ["y"], units: [""], metadata: {} },
  };
  const overlay = (): FitOverlay => ({
    datasetId: "d", binding: { yKey: 0, xKey: null }, curveFit: true, ...fitOverlayColumn(display(), PAIRS, KEPT, N)!,
  });

  it("restores the same display curve from JSON, x re-read from the rows", () => {
    const saved = JSON.parse(JSON.stringify(captureFit(overlay(), DS))) as unknown;
    expect(sanitizeFigureOverlays(saved)?.fit?.full?.rows).toEqual([0, 2, 3, 1, 5, 3]); // run-length
    const back = fitFromDocument(saved, DS)!;
    // NaN (a gap) comes back null, as for every saved curve; spans stay undefined.
    expect(back.y).toEqual(overlay().y.map((v) => (v === undefined || Number.isFinite(v) ? v : null)));
    expect(back.full).toEqual({ resultId: "rid", model: "Linear", params: [1, 10], rows: ROWS, x: X });
  });

  it("after a restart (unknown id) evaluates the model: the dense curve equals the old path", async () => {
    vi.mocked(postJSON).mockRejectedValue(new HttpError(409, "unknown_fit_result"));
    vi.mocked(fitBands).mockResolvedValue(bands(Y_FIT));
    const back = fitFromDocument(JSON.parse(JSON.stringify(captureFit(overlay(), DS))), DS)!;
    const dense = await fullFitOverlay(back);
    // What a figure saved with the FULL curve restores (gaps are null in JSON).
    const old: FitOverlay = { datasetId: "d", binding: { yKey: 0, xKey: null }, y: expandToFull(restoreGapRows(Y_FIT, PAIRS), KEPT, N) };
    expect(dense.y).toEqual(fitFromDocument(JSON.parse(JSON.stringify(captureFit(old, DS))), DS)!.y);
    expect(vi.mocked(fitBands).mock.calls[0]![0]).toMatchObject({ x: X, params: [1, 10] });
  });

  it("refuses a malformed source rather than guess rows", () => {
    const saved = JSON.parse(JSON.stringify(captureFit(overlay(), DS))) as { fit: { full: { rows: number[] } } };
    saved.fit.full.rows = [6, 5]; // runs past the sheet
    expect(fitFromDocument(saved, DS)).toBeNull();
    expect(sanitizeFigureOverlays({ ...saved, fit: { ...saved.fit, full: { model: 1 } } })).toBeUndefined();
  });
});
