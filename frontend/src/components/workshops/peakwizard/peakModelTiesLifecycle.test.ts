// Review of gap audit 4 G5 (M1, L2): an expression tie's operation and
// coefficient belong to the tie. Every path that withdraws or replaces a tie
// (untie, a deleted / set-aside peak, a rejected tie edit, Share FWHM) must
// drop them too, or the NEXT plain tie is silently sent as a ratio/offset.

import { describe, expect, it } from "vitest";

import { DEFAULT_FIT, extractPeak, removedAt, remapFitPeaks, type PeakRecipeFit } from "../../../lib/peakRecipeFit";
import {
  applyEdits,
  buildSetup,
  fwhmShared,
  modelFitBody,
  NO_EXPR,
  patchParam,
  recordEdits,
  seedSetup,
  setFwhmShared,
  withShareFwhm,
  type ModelSetup,
  type SeedPeak,
} from "./peakModelParams";

const X = Array.from({ length: 101 }, (_, i) => i / 10);
const Y = X.map((x) => 1 + 0.2 * x);
const PEAKS: SeedPeak[] = [
  { center: 2, height: 4, bg: 1.4, fwhm: 0.8 },
  { center: 5, height: 3, bg: 2, fwhm: 1 },
  { center: 8, height: 2, bg: 2.6, fwhm: 1.2 },
];
const MODEL = { shape: "Gaussian", bgDegree: 0, linkMode: "None" };
const sent = (s: ModelSetup, n: string) => modelFitBody(s, X, Y).parameters.find((p) => p.name === n)!;

describe("an expression tie's op/coefficient go with the tie", () => {
  it("a deleted peak's remap drops a withdrawn tie's op (so Share FWHM's copy is a copy)", () => {
    const fit: PeakRecipeFit = {
      ...DEFAULT_FIT, shareFwhm: true,
      params: { "p2.fwhm": { tie: "p1.fwhm", tieOp: "ratio", tieCoef: 1.5 } },
    };
    const after = remapFitPeaks(fit, removedAt(1));
    expect(after.params["p1.fwhm"] ?? {}).toEqual({});
    const s = buildSetup(PEAKS.slice(0, 2), after, MODEL, X, Y);
    expect(sent(s, "p1.fwhm")).toMatchObject({ tie: "p0.fwhm" });
    expect(sent(s, "p1.fwhm")).not.toHaveProperty("tie_op");
  });

  it("a set-aside peak drops a tie to a peak that is gone, op included", () => {
    const fit: PeakRecipeFit = {
      ...DEFAULT_FIT, params: { "p1.center": { tie: "p0.center", tieOp: "offset", tieCoef: 2, value: 5 } },
    };
    expect(extractPeak(fit, 1, []).params).toEqual({ center: { value: 5 } });
  });

  it("a rejected tie edit restores the seed's whole tie", () => {
    const seeded = setFwhmShared(seedSetup(PEAKS, ["gaussian", "gaussian", "gaussian"], "constant", X, Y), true);
    const s = applyEdits(seeded, { params: { "p1.fwhm": { tie: "p9.fwhm", tieOp: "ratio", tieCoef: 3 } }, shareVary: {} });
    const p = s.params.find((q) => q.name === "p1.fwhm")!;
    expect([p.tie, p.tieOp, p.tieCoef]).toEqual(["p0.fwhm", undefined, undefined]);
  });

  it("untie, then Share FWHM, sends plain copies and reads as shared", () => {
    let s = seedSetup(PEAKS.slice(0, 2), ["gaussian", "gaussian"], "constant", X, Y);
    s = patchParam(s, "p1.fwhm", { tie: "p0.fwhm", tieOp: "ratio", tieCoef: 3 });
    s = patchParam(s, "p1.fwhm", { tie: null, ...NO_EXPR }); // what the table's untie patches
    s = setFwhmShared(s, true);
    expect(fwhmShared(s.params)).toBe(true);
    expect(sent(s, "p1.fwhm")).not.toHaveProperty("tie_op");
    // A ratio tie on the shared field is NOT "shared".
    expect(fwhmShared(patchParam(s, "p1.fwhm", { tieOp: "ratio", tieCoef: 2 }).params)).toBe(false);
  });

  it("an untie recorded as edits leaves no op behind; Share FWHM drops tie-op edits", () => {
    const s = seedSetup(PEAKS.slice(0, 2), ["gaussian", "gaussian"], "constant", X, Y);
    const tied = patchParam(s, "p1.fwhm", { tie: "p0.fwhm", tieOp: "ratio", tieCoef: 3 });
    let edits = recordEdits({}, s.params, tied.params);
    edits = recordEdits(edits, tied.params, patchParam(tied, "p1.fwhm", { tie: null, ...NO_EXPR }).params);
    expect(edits["p1.fwhm"]).toEqual({ tie: null });
    const fit = withShareFwhm({ ...DEFAULT_FIT, params: { "p1.fwhm": { tieOp: "ratio", tieCoef: 3, value: 1 } } }, s, true);
    expect(fit.params["p1.fwhm"]).toEqual({ value: 1 });
  });

  it("Share FWHM covers the split shapes' left/right widths (L2)", () => {
    const s = setFwhmShared(seedSetup(PEAKS.slice(0, 2), ["split_gaussian", "split_gaussian"], "constant", X, Y), true);
    expect(s.params.find((p) => p.name === "p1.fwhm_left")?.tie).toBe("p0.fwhm_left");
    expect(s.params.find((p) => p.name === "p1.fwhm_right")?.tie).toBe("p0.fwhm_right");
    expect(fwhmShared(s.params)).toBe(true);
  });
});
