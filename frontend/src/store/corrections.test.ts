// SILENT_STATE_CORRUPTION_PLAN task #6: `applyCorrections`/`resetCorrections`
// deleting the measurement column. The plan's Completed table used to record
// "corrections.ts audited and cleared" -- that reasoning ("raw is `ds.raw ??
// ds.data`, so the strip is balanced") holds only at the INSTANT of one
// apply. `addFormula`/`removeFormula` grow/shrink `Dataset.data`'s width and
// never touch `Dataset.raw`, so the two drift apart across the dataset's
// lifecycle -- and the next `applyCorrections` (or a Reset) fed the
// drifted-width `raw` into a STRIPPING recompute, deleting real base columns
// or inventing a phantom duplicate. Root cause: `store/reimport.ts` always
// wrote `raw` base-only; `corrections.ts` wrote base+computed. Fixed by
// defining `Dataset.raw` as ALWAYS base-only (captured via `baseColumns` at
// the capture site) and routing both paths through the non-stripping
// `recomputeFromBase` (lib/formulaInputs.ts) on that base table -- exactly
// what #245/#4 did for reimport/derivedWorksheets.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyCorrections as applyCorrectionsApi } from "../lib/api";
import type { CorrectionsRequest } from "../lib/api";
import type { CorrectionParams, DataStruct, Dataset } from "../lib/types";
import { useApp } from "./useApp";

vi.mock("../lib/api", () => ({
  applyCorrections: vi.fn(),
  uploadFile: vi.fn(),
  fetchBookData: vi.fn(),
  importFile: vi.fn(),
  guessImportSettings: vi.fn(),
  parseImportText: vi.fn(),
  fitModel: vi.fn(),
}));
vi.mock("./toasts", () => ({ toast: vi.fn() }));

const base: DataStruct = {
  time: [1, 2, 3],
  values: [[10], [20], [30]],
  labels: ["m"],
  units: ["emu"],
  metadata: {},
};

// A stand-in backend: corrections preserve the column count and scale the
// values, which is all these tests need.
function fakeCorrections(req: CorrectionsRequest): Promise<DataStruct> {
  const d = req.dataset;
  return Promise.resolve({ ...d, values: d.values.map((row) => row.map((v) => v * 2)) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(applyCorrectionsApi).mockImplementation(fakeCorrections);
  const ds: Dataset = { id: "d1", name: "sample", data: base };
  useApp.setState({
    datasets: [ds],
    activeId: "d1",
    selectedIds: [],
    history: [],
    future: [],
    status: "",
    recalcMode: "off",
    staleDatasets: [],
    staleFits: [],
    fitOverlay: null,
    peakOverlay: null,
    baselineOverlay: null,
    derivOverlay: null,
  });
});

describe("applyCorrections + computed columns (data loss)", () => {
  it("apply -> add column -> re-apply must not delete the measurement column", async () => {
    // 1. Smooth the raw scan. `raw` is captured base-only, width 1.
    await useApp.getState().applyCorrections("d1", { smooth: 3 } as CorrectionParams);
    expect(useApp.getState().datasets[0].data.labels).toEqual(["m"]);
    expect(useApp.getState().datasets[0].raw?.labels).toEqual(["m"]);

    // 2. Add a computed column. `data` grows to width 2; `raw` stays base-only.
    useApp.getState().addFormula("d1", "2m", "A*2");
    expect(useApp.getState().datasets[0].data.labels).toEqual(["m", "2m"]);
    expect(useApp.getState().datasets[0].raw?.labels).toEqual(["m"]);

    // 3. Tweak the correction again. Corrections replace, not accumulate
    //    (module doc): the base-only `raw` stays the PRISTINE original
    //    [10,20,30] throughout, so re-applying corrects fresh from it (the
    //    fake backend doubles -> [20,40,60]), and "2m" recomputes fresh from
    //    THAT corrected base -- not stripped off a too-narrow raw and lost.
    await useApp.getState().applyCorrections("d1", { smooth: 5 } as CorrectionParams);
    const after = useApp.getState().datasets[0];
    expect(after.data.labels).toEqual(["m", "2m"]);
    expect(after.data.values).toEqual([
      [20, 40],
      [40, 80],
      [60, 120],
    ]);
    expect(after.raw?.values).toEqual([[10], [20], [30]]); // still pristine
  });

  it("apply -> add column -> RESET corrections must not delete the measurement column", async () => {
    await useApp.getState().applyCorrections("d1", { smooth: 3 } as CorrectionParams);
    useApp.getState().addFormula("d1", "2m", "A*2");
    // "Reset corrections" is the user's undo button for a correction. It
    // installs `d.raw` (base-only) as `data` and recomputes the formula
    // fresh from it.
    useApp.getState().resetCorrections("d1");
    const after = useApp.getState().datasets[0];
    expect(after.data.labels).toEqual(["m", "2m"]);
    expect(after.data.values[0][0]).toBe(10);
    expect(after.data.values[0][1]).toBe(20); // 2m recomputed from the restored raw "m"
  });

  it("removeFormula then a re-apply must not invent a phantom duplicate column", async () => {
    // Start with two computed columns already applied, then correct.
    useApp.getState().addFormula("d1", "F1", "A*2");
    useApp.getState().addFormula("d1", "F2", "A*3");
    await useApp.getState().applyCorrections("d1", { smooth: 3 } as CorrectionParams);
    expect(useApp.getState().datasets[0].raw?.labels).toEqual(["m"]); // base-only, not "m,F1,F2"

    // Delete F2. `data` shrinks to 2 columns.
    useApp.getState().removeFormula("d1", 1);
    expect(useApp.getState().datasets[0].data.labels).toEqual(["m", "F1"]);

    // Re-apply: the base-only raw corrects just "m"; F1 recomputes fresh.
    await useApp.getState().applyCorrections("d1", { smooth: 5 } as CorrectionParams);
    expect(useApp.getState().datasets[0].data.labels).toEqual(["m", "F1"]);
  });

  it("a dataset with a formula BEFORE its first correction still captures a base-only raw", async () => {
    // The formula exists before corrections are ever applied -- ds.data is
    // already width 2 ("m","2m") at capture time. `raw` must still be
    // captured as base-only ("m"), not the current width-2 `ds.data`.
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "sample",
          data: { ...base, labels: ["m", "2m"], units: ["emu", "emu"], values: [[10, 20], [20, 40], [30, 60]] },
          formulas: [{ name: "2m", expr: "A*2" }],
        },
      ],
    });

    await useApp.getState().applyCorrections("d1", { smooth: 3 } as CorrectionParams);

    const after = useApp.getState().datasets[0];
    expect(after.raw?.labels).toEqual(["m"]);
    expect(after.data.labels).toEqual(["m", "2m"]);
    expect(after.data.values).toEqual([
      [20, 40],
      [40, 80],
      [60, 120],
    ]);
  });
});
