// The batch's client half (audit P2.4 slice 4): channels by name, the
// working segment (range, exclusions, gaps), and — the claim the split rests
// on — a prepared item is EXACTLY the body the wizard's own code builds for
// that dataset (baseline subtracted, peaks found, seed + the recipe's stored
// edits on top). Errors come back as reasons, never throws.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_RECIPE, subtractBaseline, type PeakRecipe } from "../../../lib/peakwizard";
import type { Dataset } from "../../../lib/types";
import {
  batchChannels,
  batchSegment,
  prepareBatchItem,
  recipeBatchBlock,
  type BatchChannels,
} from "./peakBatchPrep";
import { buildSetup, modelFitBody } from "./peakModelParams";

const { findMock, alsMock } = vi.hoisted(() => ({ findMock: vi.fn(), alsMock: vi.fn() }));
vi.mock("../../../lib/api/peaks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/peaks")>()),
  findPeaks: findMock,
}));
vi.mock("../../../lib/api/baseline", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/baseline")>()),
  baselineALS: alsMock,
}));

const N = 40;
function dataset(id: string, labels: string[], col: (i: number) => number[], extra: Partial<Dataset> = {}): Dataset {
  return {
    id, name: id,
    data: {
      time: Array.from({ length: N }, (_, i) => i),
      values: Array.from({ length: N }, (_, i) => col(i)),
      labels, units: labels.map(() => ""), metadata: {},
    },
    ...extra,
  };
}
const tth = (i: number) => 20 + i * 0.25;
const inten = (i: number) => 3 + 10 * Math.exp(-((i - 20) ** 2) / 6);
const A = dataset("a", ["2theta", "I"], (i) => [tth(i), inten(i)]);
// Same columns in another ORDER, plus an extra one.
const B = dataset("b", ["I", "T", "2theta"], (i) => [inten(i) * 2, 300, tth(i)]);
const CH: BatchChannels = { xLabel: "2theta", yLabel: "I", xIndex: 0, yIndex: 1 };
const PEAK = { center: 25, height: 10, bg: 0, fwhm: 1, prominence: 10, localSNR: 30, area: null };

const recipe = (over: Partial<PeakRecipe> = {}): PeakRecipe => ({ ...DEFAULT_RECIPE, name: "r", ...over });

beforeEach(() => {
  vi.clearAllMocks();
  findMock.mockResolvedValue({ peaks: [PEAK], background: [] });
  alsMock.mockImplementation(({ y }: { y: number[] }) => Promise.resolve({ baseline: y.map(() => 3) }));
});

describe("batchChannels", () => {
  it("names the wizard's plotted X and primary Y", () => {
    expect(batchChannels(A, 0, [1], null)).toEqual(CH);
  });
  it("the time axis is a null x label", () => {
    expect(batchChannels(A, null, [1], null)).toEqual({ xLabel: null, yLabel: "I", xIndex: null, yIndex: 1 });
  });
  it("no dataset, no channels", () => {
    expect(batchChannels(null, 0, [1], null)).toBeNull();
  });
});

describe("batchSegment", () => {
  it("matches columns by NAME in a dataset whose order differs", () => {
    const seg = batchSegment(B, CH, { lo: null, hi: null });
    expect(seg.x[3]).toBe(tth(3));
    expect(seg.y[3]).toBe(inten(3) * 2);
  });
  it("a missing column is a named error, never another column", () => {
    const C = dataset("c", ["2theta", "Counts"], (i) => [tth(i), inten(i)]);
    expect(() => batchSegment(C, CH, { lo: null, hi: null })).toThrow('no column named "I"');
  });
  it("honours the range, excluded rows and drops gaps (counted)", () => {
    const D = dataset("d", ["2theta", "I"], (i) => [tth(i), i === 5 ? Number.NaN : inten(i)], { excludedRows: [6] });
    const seg = batchSegment(D, CH, { lo: tth(2), hi: tth(9) });
    expect(seg.x).toEqual([2, 3, 4, 7, 8, 9].map(tth));
    expect(seg.gapCount).toBe(1);
  });
  it("an empty range says so", () => {
    expect(() => batchSegment(A, CH, { lo: 100, hi: 200 })).toThrow("no finite X/Y pairs in the recipe's range");
  });
});

describe("prepareBatchItem", () => {
  const edited = recipe({
    baseline: { ...DEFAULT_RECIPE.baseline, method: "als" },
    model: { ...DEFAULT_RECIPE.model, shape: "Pseudo-Voigt" },
    fit: { ...DEFAULT_RECIPE.fit, params: { "p0.eta": { value: 0.3, vary: false } } },
  });

  it("builds exactly the wizard's body: baseline subtracted, found peaks seeded, stored edits on top", async () => {
    const out = await prepareBatchItem(B, edited, CH);
    if (!out.ok) throw new Error(out.error);
    const seg = batchSegment(B, CH, edited.range);
    const workingY = subtractBaseline(seg.y, seg.y.map(() => 3));
    const setup = buildSetup([{ center: 25, height: 10, bg: 0, fwhm: 1 }], edited.fit, edited.model, seg.x, workingY);
    expect(out.item).toEqual(modelFitBody(setup, seg.x, workingY));
    // The recipe's edit reached the table; the find ran on the corrected trace.
    expect(out.item.parameters.find((p) => p.name === "p0.eta")).toMatchObject({ value: 0.3, vary: false });
    expect(findMock.mock.calls[0][0].y).toEqual(workingY);
    expect(out.nPeaks).toBe(1);
  });

  it("returns reasons instead of throwing", async () => {
    findMock.mockResolvedValueOnce({ peaks: [], background: [] });
    expect(await prepareBatchItem(A, recipe(), CH)).toEqual({ ok: false, error: "no peaks found (SNR threshold 3)" });
    findMock.mockResolvedValueOnce({ peaks: Array.from({ length: 51 }, () => PEAK), background: [] });
    expect(await prepareBatchItem(A, recipe(), CH)).toEqual({ ok: false, error: "51 peaks found; the model fit takes at most 50" });
    findMock.mockRejectedValueOnce(new Error("snr_threshold must be finite"));
    expect(await prepareBatchItem(A, recipe(), CH)).toEqual({ ok: false, error: "snr_threshold must be finite" });
    const C = dataset("c", ["2theta", "Counts"], (i) => [tth(i), inten(i)]);
    expect(await prepareBatchItem(C, recipe(), CH)).toEqual({ ok: false, error: 'no column named "I"' });
  });

  it("a table the backend would refuse is an error row with the table's reason", async () => {
    const bad = recipe({ fit: { ...DEFAULT_RECIPE.fit, params: { "p0.fwhm": { value: -1 } } } });
    const out = await prepareBatchItem(A, bad, CH);
    expect(out).toEqual({ ok: false, error: "parameter table: #1 FWHM: a width must be positive" });
  });

  it("notes gap rows", async () => {
    const D = dataset("d", ["2theta", "I"], (i) => [tth(i), i === 5 ? Number.NaN : inten(i)]);
    const out = await prepareBatchItem(D, recipe(), CH);
    expect(out.ok && out.notes).toEqual(["1 gap rows in range were excluded"]);
  });
});

describe("recipeBatchBlock", () => {
  it("refuses a Classic-engine recipe with the way out", () => {
    expect(recipeBatchBlock(recipe({ fit: { ...DEFAULT_RECIPE.fit, engine: "classic" } }))).toMatch(/Classic engine.*switch the recipe to the model engine/);
    expect(recipeBatchBlock(recipe())).toBeNull();
  });
});
