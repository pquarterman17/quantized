// A background re-fit adopted by the Curve Fit session (store/curveFitRefit.ts)
// keeps the fit's WEIGHTING meaning: the announcement carries the column the
// re-fit sent, which for a direct-weighted fit holds weights, not 1-sigma
// errors. Read as `dy` the report would use 1/w² (and refuse a zero weight).

import { beforeEach, describe, expect, it } from "vitest";

import { announceFitRecomputed } from "../lib/fitRecomputeEvents";
import type { Dataset, FitSpec } from "../lib/types";
import { followRefits } from "./curveFitRefit";
import { retainFitted, retainedFit } from "./curveFitSession";
import { useApp } from "./useApp";

const data = { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["Y"], units: [""], metadata: {} };

function setup(weight: FitSpec["weight"]): { ds: Dataset; next: FitSpec } {
  const spec: FitSpec = { model: "Linear", xKey: null, yKey: 0, params: [1, 0], ...(weight ? { weight } : {}) };
  const ds: Dataset = { id: "d1", name: "run.dat", data, fitSpec: spec };
  retainFitted(null, null);
  retainFitted({
    result: { params: [1, 0] }, fitData: { x: [0, 1, 2], y: [1, 2, 3], xKey: null, yKey: 0, dy: null },
    datasetId: "d1", model: "Linear", xKey: null, yKey: 0,
  }, ds);
  const next = { ...spec, params: [1.1, 0] };
  useApp.setState({ datasets: [{ ...ds, fitSpec: next }], fitOverlay: null });
  return { ds, next };
}

beforeEach(() => followRefits());

describe("followRefits", () => {
  it("a direct-weighted re-fit is adopted with `weights`, not `dy`", () => {
    const { ds } = setup({ mode: "direct", errKey: 0 });
    announceFitRecomputed({
      datasetId: "d1", previousSpec: ds.fitSpec!, result: { params: [1.1, 0] },
      x: [0, 1, 2], y: [1, 2, 3], dy: [2, 0, 1], curve: null,
    });
    expect(retainedFit("d1")?.fitted.fitData).toMatchObject({ dy: null, weights: [2, 0, 1] });
  });

  it("an error-column re-fit keeps its 1-sigma errors as `dy`", () => {
    const { ds } = setup({ mode: "yerr", errKey: 0 });
    announceFitRecomputed({
      datasetId: "d1", previousSpec: ds.fitSpec!, result: { params: [1.1, 0] },
      x: [0, 1, 2], y: [1, 2, 3], dy: [0.1, 0.2, 0.3], curve: null,
    });
    expect(retainedFit("d1")?.fitted.fitData).toEqual(expect.objectContaining({ dy: [0.1, 0.2, 0.3] }));
    expect(retainedFit("d1")?.fitted.fitData?.weights).toBeUndefined();
  });
});
