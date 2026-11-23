// The fit-input selector (selectedFitData / resolveFitInputs) reads rows through
// the shared resolver (lib/analysisInputs), never on its own. The legacy
// algorithm is kept below as an ORACLE: the same rows and columns as before,
// proven across exclusions, the Data Filter, selected rows, the X range and a
// per-series X.
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as analysisInputs from "./analysisInputs";
import { effectiveChannels } from "./plotdata";
import { ownXKey } from "./perSeriesX";
import { analysisView } from "./rowstate";
import { fitChannelOf, fitSelectionRefusal, resolveFitInputs, selectedFitData } from "./fitselection";
import type { Dataset } from "./types";

vi.mock("./analysisInputs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./analysisInputs")>();
  return { ...actual, resolveAnalysisInputs: vi.fn((request: Parameters<typeof actual.resolveAnalysisInputs>[0]) => actual.resolveAnalysisInputs(request)) };
});

const rows = Array.from({ length: 8 }, (_v, i) => i);
const base: Dataset = {
  id: "d",
  name: "two-x.dat",
  data: {
    time: rows,
    // T1, R1, T2, R2: R2 is plotted against T2 (own X), not the shared X.
    values: rows.map((i) => [i * 10, i + 1, i * 100, i * 2]),
    labels: ["T1", "R1", "T2", "R2"],
    units: ["", "", "", ""],
    metadata: {},
  },
  columnDesignations: ["X", "Y", "X", "Y"],
};

/** The pre-resolver algorithm, verbatim, as the oracle. */
function legacy(
  dataset: Dataset, xKey: number | null, yKeys: number[] | null, order: number[] | null,
  subset?: { rowIds: number[] | null; range: { lo: number; hi: number; source: "manual" } | null },
) {
  const view = analysisView(dataset);
  const data = view.data!;
  const yKey = effectiveChannels(data, yKeys, xKey, dataset.channelRoles, order)[0];
  const fitX = ownXKey(dataset, xKey, yKey);
  const allX = fitX == null ? data.time : data.values.map((row) => row[fitX]);
  const allY = data.values.map((row) => row[yKey]);
  if (!subset || (subset.rowIds === null && subset.range === null)) return { x: allX, y: allY, yKey, xKey: fitX };
  const sourceRows = view.rowIds ?? data.time.map((_v, i) => i);
  const wanted = subset.rowIds === null ? null : new Set(subset.rowIds);
  const analysisRows: number[] = [];
  sourceRows.forEach((row, index) => {
    if (wanted && !wanted.has(row)) return;
    const x = allX[index];
    if (subset.range && (!Number.isFinite(x) || x < subset.range.lo || x > subset.range.hi)) return;
    analysisRows.push(index);
  });
  return {
    x: analysisRows.map((i) => allX[i]), y: analysisRows.map((i) => allY[i]), yKey, xKey: fitX,
    analysisRows, sourceRows: analysisRows.map((i) => sourceRows[i]), sourceRowCount: dataset.data.time.length,
  };
}

const variants: Record<string, Dataset> = {
  plain: base,
  "manual exclusions": { ...base, excludedRows: [1, 4] },
  "data filter": { ...base, filter: [{ col: 1, kind: "range", min: 3 }] },
  both: { ...base, excludedRows: [0], filter: [{ col: 1, kind: "range", max: 7 }] },
};
const subsets = {
  none: undefined,
  "rows only": { rowIds: [0, 2, 3, 5, 7], range: null },
  "range only": { rowIds: null, range: { lo: 150, hi: 500, source: "manual" as const } },
  "rows and range": { rowIds: [1, 2, 3, 6], range: { lo: 200, hi: 600, source: "manual" as const } },
};

beforeEach(() => {
  vi.mocked(analysisInputs.resolveAnalysisInputs).mockClear();
});

describe("selectedFitData reads rows through resolveAnalysisInputs", () => {
  it("calls the resolver (a bypass fails this)", () => {
    expect(selectedFitData(base, 0, [1], null)?.yKey).toBe(1);
    expect(analysisInputs.resolveAnalysisInputs).toHaveBeenCalledTimes(1);
    expect(vi.mocked(analysisInputs.resolveAnalysisInputs).mock.calls[0][0]).toMatchObject({
      policy: analysisInputs.ROW_POLICY.selection, xKey: 0, yKeys: [1],
    });
  });

  it("asks the resolver for the lean path (no excluded/filtered recount per render)", () => {
    selectedFitData(base, 0, [1], null);
    expect(vi.mocked(analysisInputs.resolveAnalysisInputs).mock.calls[0][0].counts).toBe(false);
  });

  it("the lean path returns the same rows as the counting resolver", async () => {
    const actual = await vi.importActual<typeof import("./analysisInputs")>("./analysisInputs");
    for (const dataset of Object.values(variants)) {
      for (const subset of Object.values(subsets)) {
        const explicit = !!subset && (subset.rowIds !== null || subset.range !== null);
        const counted = actual.resolveAnalysisInputs({
          datasets: [dataset], activeId: dataset.id, xKey: 0, yKeys: [1], policy: actual.ROW_POLICY.selection,
          selection: explicit && subset ? { datasetId: dataset.id, xKey: 0, yKeys: [1], errorBindings: [], errorKeys: {}, factorKeys: [], rowIds: subset.rowIds, range: subset.range, roi: null } : null,
        });
        const lean = selectedFitData(dataset, 0, [1], null, subset);
        if (!counted.ok) { expect(lean).toBeNull(); continue; }
        expect(counted.countsKnown).toBe(true);
        const { x, y } = actual.analysisSeries(counted);
        expect(lean).toMatchObject({ x, y });
        if (explicit) expect(lean?.sourceRows).toEqual(counted.rowIds);
      }
    }
  });

  it("reads the channel identity without the resolver or any rows", () => {
    expect(fitChannelOf({ ...base, pending: { kind: "upload", bookId: "b", rows: 8, cols: 4, previewSampled: true } }, 0, [3], null))
      .toEqual({ yKey: 3, xKey: 2, refusal: null });
    expect(analysisInputs.resolveAnalysisInputs).not.toHaveBeenCalled();
  });

  for (const [vName, dataset] of Object.entries(variants)) {
    for (const [sName, subset] of Object.entries(subsets)) {
      for (const [xKey, yKeys] of [[0, [1]], [0, [3]], [null, [1, 3]]] as const) {
        it(`same rows and columns as before: ${vName} / ${sName} / X${xKey} Y${yKeys.join(",")}`, () => {
          const expected = legacy(dataset, xKey, [...yKeys], null, subset);
          const got = selectedFitData(dataset, xKey, [...yKeys], null, subset);
          if (expected.x.length === 0) {
            expect(got).toBeNull(); // an empty row set is refused now, never an empty fit
            return;
          }
          expect(got).toEqual(expected);
        });
      }
    }
  }

  it("fits the secondary Y against its own X", () => {
    expect(selectedFitData(base, 0, [3], null)).toMatchObject({ yKey: 3, xKey: 2, x: base.data.values.map((r) => r[2]) });
  });
});

describe("refusals carry the resolver's reason (fail closed)", () => {
  const lazy: Dataset = { ...base, pending: { kind: "upload", bookId: "b", rows: 8, cols: 4, previewSampled: true } };

  it("an explicitly empty row selection", () => {
    const r = resolveFitInputs(base, 0, [1], null, { rowIds: [], range: null });
    expect(r).toMatchObject({ ok: false, code: "no-rows" });
    expect(fitSelectionRefusal(base, 0, [1], null, { rowIds: [], range: null })).toMatch(/row selection is empty/);
    expect(selectedFitData(base, 0, [1], null, { rowIds: [], range: null })).toBeNull();
  });

  it("a range that leaves no rows", () => {
    expect(fitSelectionRefusal(base, 0, [1], null, { rowIds: null, range: { lo: 1e6, hi: 2e6, source: "manual" } }))
      .toMatch(/No rows remain/);
  });

  it("the Data Filter really drops rows in the oracle variants", () => {
    expect(selectedFitData(variants["data filter"], 0, [1], null)?.x.length).toBeLessThan(8);
    expect(selectedFitData(variants.both, 0, [1], null)?.x.length).toBeLessThan(7);
  });

  it("every row excluded", () => {
    const none = { ...base, excludedRows: rows };
    expect(fitSelectionRefusal(none, 0, [1], null)).toMatch(/No rows remain/);
  });

  it("a lazy Origin preview is never fitted", () => {
    expect(selectedFitData(lazy, 0, [1], null)).toBeNull();
    expect(fitSelectionRefusal(lazy, 0, [1], null)).toMatch(/still loading/);
  });

  it("a Y that is an X column keeps its own reason", () => {
    expect(resolveFitInputs(base, null, [2], null)).toMatchObject({ ok: false, code: "y-is-x" });
    expect(fitSelectionRefusal(base, null, [2], null)).toMatch(/is an X column/);
  });

  it("no plotted channel is a null refusal (callers say their own line)", () => {
    const roled = { ...base, channelRoles: { 0: "ignore", 1: "ignore", 2: "ignore", 3: "ignore" } } as unknown as Dataset;
    expect(resolveFitInputs(roled, null, [1], null)).toMatchObject({ ok: false, code: "no-response" });
    expect(fitSelectionRefusal(roled, null, [1], null)).toBeNull();
    expect(fitSelectionRefusal(null, null, null, null)).toBeNull();
  });
});
