// The Peaks detect/fit input reads rows through the shared resolver and FAILS
// CLOSED on a refusal: an empty explicit row selection must never fall back to
// analysing the whole sheet.
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as analysisInputs from "../../../lib/analysisInputs";
import type { Dataset } from "../../../lib/types";
import { peakInputs } from "./peakInputs";

vi.mock("../../../lib/analysisInputs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/analysisInputs")>();
  return { ...actual, resolveAnalysisInputs: vi.fn((request: Parameters<typeof actual.resolveAnalysisInputs>[0]) => actual.resolveAnalysisInputs(request)) };
});

const ds = (extra: Partial<Dataset> = {}): Dataset => ({
  id: "d", name: "s",
  data: { time: [0, 1, 2, 3, 4, 5], values: [[1], [5], [2], [6], [2], [1]], labels: ["I"], units: [""], metadata: {} },
  ...extra,
});

beforeEach(() => {
  vi.mocked(analysisInputs.resolveAnalysisInputs).mockClear();
});

describe("peakInputs on the shared resolver", () => {
  it("reads rows through resolveAnalysisInputs", () => {
    expect(peakInputs(ds(), null, null, null).x).toEqual([0, 1, 2, 3, 4, 5]);
    expect(analysisInputs.resolveAnalysisInputs).toHaveBeenCalledTimes(1);
  });

  it("excluded and filtered rows are left out; selected rows and range narrow", () => {
    expect(peakInputs(ds({ excludedRows: [1] }), null, null, null).x).toEqual([0, 2, 3, 4, 5]);
    expect(peakInputs(ds({ filter: [{ col: 0, kind: "range", min: 2 }] }), null, null, null).y).toEqual([5, 2, 6, 2]);
    const narrowed = peakInputs(ds({ excludedRows: [3] }), null, null, null, { rowIds: [1, 3, 5], range: { lo: 2, hi: 5, source: "manual" } });
    expect(narrowed.x).toEqual([5]);
    expect(narrowed.sourceRows).toEqual([5]);
  });

  it("an empty explicit row selection refuses with the resolver's reason (no whole-sheet fallback)", () => {
    const inputs = peakInputs(ds(), null, null, null, { rowIds: [], range: null });
    expect(inputs.x).toEqual([]);
    expect(inputs.fallback).toBeUndefined();
    expect(inputs.refusal).toMatch(/row selection is empty/);
  });

  it("no rows left after exclusions refuses; a lazy preview refuses", () => {
    expect(peakInputs(ds({ excludedRows: [0, 1, 2, 3, 4, 5] }), null, null, null).refusal).toMatch(/No rows remain/);
    const lazy = ds({ pending: { kind: "upload", bookId: "b", rows: 6, cols: 1, previewSampled: true } });
    expect(peakInputs(lazy, null, null, null).refusal).toMatch(/still loading/);
  });

  it("with no plotted channel the first-value-channel fallback still applies (unchanged)", () => {
    // Every channel ignored -> nothing plotted -> the legacy fallback, no refusal.
    const roled = ds({ channelRoles: { 0: "ignore" } as never });
    const inputs = peakInputs(roled, null, [0], null);
    expect(inputs.refusal).toBeUndefined();
    expect(inputs.fallback).toBe(true);
  });
});
