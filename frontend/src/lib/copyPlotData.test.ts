// Audit finding 3: "Copy data" (TSV) never copies a thinned fit / baseline
// column: it fetches the full curve first, else leaves the column out.
import { beforeEach, describe, expect, it } from "vitest";

import { plotDataTSV } from "./copyPlotData";
import type { PlotPayload } from "./plotdata";
import type { BaselineOverlay, FitOverlay } from "./types";
import { rememberBaselineFull } from "../store/fitOverlayUpgrade";
import { useApp } from "../store/useApp";
import { SINGLE_X } from "../test/overlayBinding";

const payload = (baseline: (number | undefined)[]): PlotPayload =>
  ({
    data: [[0, 1, 2, 3], [1, 2, 3, 4], baseline] as never,
    series: [{ label: "y", unit: "" }, { label: "baseline", unit: "", overlay: true }],
    xLabel: "x", xUnit: "",
  }) as PlotPayload;
const THIN = payload([1, undefined, undefined, 4]);
const lean = (): BaselineOverlay => ({ datasetId: "d1", binding: SINGLE_X, y: [1, undefined, undefined, 4] as never, lean: true });

beforeEach(() => useApp.setState({ fitOverlay: null, baselineOverlay: null }));

describe("plotDataTSV", () => {
  it("copies the full baseline once the slot is upgraded and the canvas republished", async () => {
    const o = lean();
    rememberBaselineFull(o, () => Promise.resolve([1, 2, 3, 4]));
    useApp.setState({ baselineOverlay: o });
    let live: PlotPayload = THIN;
    const off = useApp.subscribe((s, p) => {
      if (s.baselineOverlay !== p.baselineOverlay) live = payload([1, 2, 3, 4]);
    });
    const { tsv, omitted } = await plotDataTSV(THIN, () => live);
    off();
    expect(omitted).toEqual([]);
    expect(tsv.split("\n").slice(1)).toEqual(["0\t1\t1", "1\t2\t2", "2\t3\t3", "3\t4\t4"]);
  });

  it("leaves the column out, and names it, when the full baseline cannot be fetched", async () => {
    useApp.setState({ baselineOverlay: lean() }); // nothing to fetch it by
    const { tsv, omitted } = await plotDataTSV(THIN, () => THIN);
    expect(omitted).toEqual(["baseline"]);
    expect(tsv.split("\n")[0]).toBe("x\ty");
    expect(tsv.split("\n")[2]).toBe("1\t2");
  });

  it("leaves a display fit's column out when it cannot be upgraded", async () => {
    // A fit whose rows do not match its curve: the upgrade throws.
    const fit = {
      datasetId: "d1", binding: SINGLE_X, curveFit: true, y: [],
      full: { resultId: undefined, model: "Linear", params: [1], rows: [], x: [] },
    } as unknown as FitOverlay;
    useApp.setState({ fitOverlay: { ...fit, full: { ...fit.full!, rows: [0, 1] } } });
    const p = { ...THIN, series: [{ label: "y", unit: "" }, { label: "fit", unit: "", overlay: true, fit: true }] } as PlotPayload;
    const { omitted } = await plotDataTSV(p, () => p);
    expect(omitted).toEqual(["fit"]);
  });

  it("copies an ordinary payload untouched", async () => {
    const { tsv, omitted } = await plotDataTSV(THIN, () => THIN);
    expect(omitted).toEqual([]);
    expect(tsv.split("\n")[1]).toBe("0\t1\t1");
  });
});
