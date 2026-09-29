// P2.2 — the fit's figure template: data + model, residual and SLD panels as
// editable figures on one Figure Page, the Q panels sharing one Q range.

import { describe, expect, it } from "vitest";

import { PAGE_DOCUMENT_SCHEMA, sanitizePageDocuments } from "../../../lib/pageDocument";
import { savedCurves } from "./reflFitCurves";
import { reflFitFigurePage } from "./reflFitFigure";
import { fitResponse } from "./reflFit.testkit";

let n = 0;
const ids = { figure: () => `figure-${++n}`, page: "page-1", now: "2026-09-29T00:00:00.000Z" };

describe("reflFitFigurePage", () => {
  it("lays out data + model, residuals and SLD as one column of three linked panels", () => {
    n = 0;
    const curves = savedCurves(fitResponse());
    const { figures, page } = reflFitFigurePage({ ids: ["model-ds", "sld-ds"], curves, weighting: "dr", base: "film.refl — refl fit #1" }, ids);
    expect(figures.map((f) => [f.name, f.bindings.datasetId, f.bindings.yKeys])).toEqual([
      ["film.refl — refl fit #1 R(Q)", "model-ds", [0, 1]],
      ["film.refl — refl fit #1 residuals", "model-ds", [2]],
      ["film.refl — refl fit #1 SLD", "sld-ds", [0]],
    ]);
    const [r, res, sld] = figures.map((f) => f.plot.view);
    expect(r.yScale).toBe("log");
    expect(r.seriesStyles[0]).toEqual({ marker: true, width: 0 }); // data as points, model as a line
    expect(r.xLim).toEqual([0.01, 0.05]);
    expect(res.xLim).toEqual(r.xLim); // the shared Q axis
    expect(res.refLines).toEqual([{ id: "zero", axis: "y", value: 0 }]);
    expect(res.yAxisLabel).toBe("residual (σ)");
    expect([sld.xAxisLabel, sld.xLim]).toEqual(["z (Å)", null]);

    expect(page).toMatchObject({ schema: PAGE_DOCUMENT_SCHEMA, id: "page-1", name: "film.refl — refl fit #1 — fit figure", rows: 3, cols: 1 });
    expect(page.panels.map((p) => p.figureId)).toEqual(["figure-1", "figure-2", "figure-3"]);
    expect(page.layout.alignLabels).toBe(true);
    // A document the workspace loader accepts as is.
    expect(sanitizePageDocuments([page])).toEqual([page]);
  });

  it("puts a PNR pair side by side on ONE Q range, the SLD profiles on the row below", () => {
    n = 0;
    const curves = savedCurves(
      fitResponse({
        curves: [
          { label: "a", spin: "+", q: [0.01, 0.02], r: [1, 0.5], dr: [0.1, 0.1], model: [0.9, 0.4], residual: [-1, -1] },
          { label: "b", spin: "-", q: [0.02, 0.06], r: [0.8, 0.3], dr: [0.1, 0.1], model: [0.7, 0.2], residual: [-1, -1] },
        ],
        sld_profiles: [
          { spin: "+", z: [0, 1], sld: [0, 1] },
          { spin: "-", z: [0, 1], sld: [0, 2] },
        ],
      }),
    );
    const { figures, page } = reflFitFigurePage({ ids: ["m+", "m-", "s+", "s-"], curves, weighting: "dr", base: "pnr" }, ids);
    expect([page.rows, page.cols]).toEqual([3, 2]);
    const byId = new Map(figures.map((f) => [f.id, f]));
    const grid = page.panels.map((p) => (p.figureId ? byId.get(p.figureId)!.name : null));
    expect(grid).toEqual(["pnr R(Q) (+)", "pnr R(Q) (-)", "pnr residuals (+)", "pnr residuals (-)", "pnr SLD (+)", "pnr SLD (-)"]);
    const qLims = figures.filter((f) => !f.name.includes("SLD")).map((f) => f.plot.view.xLim);
    expect(qLims).toEqual(qLims.map(() => [0.01, 0.06]));
  });

  it("leaves the residual row out when the fit's residuals are unknown", () => {
    n = 0;
    const { residual: _r, ...legacy } = savedCurves(fitResponse()).channels[0];
    const { figures, page } = reflFitFigurePage(
      { ids: ["m", "s"], curves: { channels: [legacy], sld: savedCurves(fitResponse()).sld }, weighting: "dr", base: "old" },
      ids,
    );
    expect(figures.map((f) => f.name)).toEqual(["old R(Q)", "old SLD"]);
    expect([page.rows, page.cols]).toEqual([2, 1]);
  });
});
