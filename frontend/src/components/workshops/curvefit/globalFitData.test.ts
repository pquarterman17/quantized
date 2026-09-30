// Global fit pure helpers: label-matched members (fail closed on a missing
// column), excluded rows kept out of the fit and put back as gaps in the
// overlay, and the result table for a subset-shared parameter.

import { describe, expect, it } from "vitest";

import type { GlobalFitResult } from "../../../lib/api/globalFit";
import type { Dataset } from "../../../lib/types";
import { channelMembers, datasetMembers, memberData, memberOverlay, resultRows, shareConstraints } from "./globalFitData";

const ds = (id: string, labels: string[], rows: number[][], extra: Partial<Dataset> = {}): Dataset => ({
  id,
  name: `${id}.dat`,
  data: { time: rows.map((_, i) => i * 10), values: rows, labels, units: labels.map(() => ""), metadata: {} },
  ...extra,
});

describe("globalFitData", () => {
  it("skips the X and role-tagged channels", () => {
    const d = ds("a", ["x", "y", "err", "z"], [[0, 1, 0.1, 2]], { channelRoles: { 2: "ignore" } });
    expect(channelMembers(d, 0).map((m) => m.label)).toEqual(["y", "z"]);
  });

  it("matches by label on the time axis, and never rebinds a missing column", () => {
    const a = ds("a", ["I", "V"], [[1, 2]]);
    const b = ds("b", ["V", "I"], [[3, 4]]);
    const c = ds("c", ["V"], [[5]]);
    const r = datasetMembers([a, b, c], a, null, 1);
    expect(r.members).toEqual([
      { datasetId: "a", xKey: null, yKey: 1, label: "a.dat" },
      { datasetId: "b", xKey: null, yKey: 0, label: "b.dat" },
      { datasetId: "c", xKey: null, yKey: 0, label: "c.dat" },
    ]);
    expect(datasetMembers([a, b, c], a, 0, 1).missing).toEqual(["c.dat"]);
  });

  it("fits only the included rows and restores them as gaps in the overlay", () => {
    const d = ds("a", ["y"], [[1], [2], [Number.NaN], [4]], { excludedRows: [1] });
    const m = { datasetId: "a", xKey: null, yKey: 0, label: "y" };
    const data = memberData(d, m)!;
    expect(data.x).toEqual([0, 30]);
    expect(data.y).toEqual([1, 4]);
    const ov = memberOverlay(d, data.pairs, [1.5, 3.5]);
    expect(ov).toHaveLength(4);
    expect(ov[0]).toBe(1.5);
    expect(ov[1]).toBeNull();
    expect(ov[2]).toBeNaN();
    expect(ov[3]).toBe(3.5);
  });

  it("tabulates a subset-shared parameter once and keeps the outsider's own value", () => {
    const r: GlobalFitResult = {
      paramNames: ["A", "σ"],
      params: [[1, 2], [3, 2], [5, 6]],
      errors: [[0.1, 0.2], [0.3, 0.2], [0.5, 0.6]],
      shared: [{ name: "sigma", paramIdx: 1, datasets: [0, 1], value: 2, error: 0.2 }],
      yFit: [],
      R2: [],
      RMSE: [],
      chiSqRed: 1,
      nTotal: 9,
      nFree: 5,
      exitFlag: 1,
    };
    const members = ["p", "q", "r"].map((label, i) => ({ datasetId: `d${i}`, xKey: null, yKey: 0, label }));
    expect(resultRows(r, members).map((row) => `${row.param}/${row.dataset}/${row.value}`)).toEqual([
      "σ/shared/2",
      "A/p/1",
      "A/q/3",
      "A/r/5",
      "σ/r/6",
    ]);
    expect(shareConstraints(["A", "σ"], [false, true], 3)).toEqual([{ param_name: "σ", datasets: [0, 1, 2] }]);
  });
});
