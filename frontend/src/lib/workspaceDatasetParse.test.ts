// SILENT_STATE_CORRUPTION_PLAN #6 version-skew: a .dwk saved by any build
// before #6 landed could carry `Dataset.raw` under the OLD contract (base +
// whatever computed columns were present at the dataset's FIRST correction
// apply) -- `store/corrections.ts` now assumes `raw` is ALWAYS base-only
// (lib/types.ts's doc) and routes it through the non-stripping
// `recomputeFromBaseOrEmpty`, so an already-wide legacy `raw` would get the
// dataset's formulas appended a SECOND time on the next apply/reset,
// inventing a phantom duplicate column. `parseWorkspaceDataset` normalizes
// `raw` to the expected base width on load, closing the load-time instance
// of the same corruption class #6 fixed for the live session.

import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "./types";
import { parseWorkspaceDataset } from "./workspaceDatasetParse";
import { useApp } from "../store/useApp";

describe("parseWorkspaceDataset — raw normalized to base-only width (#6 version-skew)", () => {
  it("strips a legacy-shaped raw (base + a stale computed column) down to the expected base width", () => {
    const legacy = {
      id: "d1",
      name: "sample",
      data: {
        time: [1, 2, 3],
        values: [[10, 20], [20, 40], [30, 60]],
        labels: ["m", "2m"],
        units: ["emu", "emu"],
        metadata: {},
      },
      // OLD contract: raw was captured base+computed at the first apply, so
      // it ALSO carries a (now-stale) "2m" column.
      raw: {
        time: [1, 2, 3],
        values: [[10, 20], [20, 40], [30, 60]],
        labels: ["m", "2m"],
        units: ["emu", "emu"],
        metadata: {},
      },
      formulas: [{ name: "2m", expr: "A*2" }],
    };

    const ds = parseWorkspaceDataset(legacy, 0);

    expect(ds.raw?.labels).toEqual(["m"]);
    expect(ds.raw?.values).toEqual([[10], [20], [30]]);
  });

  it("leaves a modern, already-base-only raw untouched", () => {
    const modern = {
      id: "d1",
      name: "sample",
      data: {
        time: [1, 2, 3],
        values: [[10, 20], [20, 40], [30, 60]],
        labels: ["m", "2m"],
        units: ["emu", "emu"],
        metadata: {},
      },
      raw: {
        time: [1, 2, 3],
        values: [[10], [20], [30]],
        labels: ["m"],
        units: ["emu"],
        metadata: {},
      },
      formulas: [{ name: "2m", expr: "A*2" }],
    };

    const ds = parseWorkspaceDataset(modern, 0);

    expect(ds.raw?.labels).toEqual(["m"]);
    expect(ds.raw?.values).toEqual([[10], [20], [30]]);
  });

  it("leaves raw untouched when the dataset has no formulas at all", () => {
    const noFormulas = {
      id: "d1",
      name: "sample",
      data: {
        time: [1, 2, 3],
        values: [[10, 20], [20, 40], [30, 60]],
        labels: ["m", "T"],
        units: ["emu", "K"],
        metadata: {},
      },
      raw: {
        time: [1, 2, 3],
        values: [[5, 20], [10, 40], [15, 60]],
        labels: ["m", "T"],
        units: ["emu", "K"],
        metadata: {},
      },
    };

    const ds = parseWorkspaceDataset(noFormulas, 0);

    expect(ds.raw?.labels).toEqual(["m", "T"]);
    expect(ds.raw?.values).toEqual([[5, 20], [10, 40], [15, 60]]);
  });

  it("never invents columns when raw is narrower than the expected base width", () => {
    const narrow = {
      id: "d1",
      name: "sample",
      data: {
        time: [1, 2, 3],
        values: [[10, 20, 20], [20, 40, 40], [30, 60, 60]],
        labels: ["m", "T", "2m"],
        units: ["emu", "K", "emu"],
        metadata: {},
      },
      // Narrower than the expected 2-column base -- nothing to invent, and
      // must not throw.
      raw: {
        time: [1, 2, 3],
        values: [[10], [20], [30]],
        labels: ["m"],
        units: ["emu"],
        metadata: {},
      },
      formulas: [{ name: "2m", expr: "A*2" }],
    };

    const ds = parseWorkspaceDataset(narrow, 0);

    expect(ds.raw?.labels).toEqual(["m"]);
  });
});

describe("legacy-shaped raw + a subsequent resetCorrections (end-to-end, #6 version-skew)", () => {
  beforeEach(() => {
    useApp.setState({
      datasets: [],
      activeId: null,
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

  it("resetCorrections on a workspace-loaded legacy dataset yields ['m','2m'], not a phantom ['m','2m','2m']", () => {
    const legacy = {
      id: "d1",
      name: "sample",
      data: {
        time: [1, 2, 3],
        values: [[10, 20], [20, 40], [30, 60]],
        labels: ["m", "2m"],
        units: ["emu", "emu"],
        metadata: {},
      },
      raw: {
        time: [1, 2, 3],
        values: [[10, 20], [20, 40], [30, 60]],
        labels: ["m", "2m"],
        units: ["emu", "emu"],
        metadata: {},
      },
      formulas: [{ name: "2m", expr: "A*2" }],
    };
    const ds: Dataset = parseWorkspaceDataset(legacy, 0);
    useApp.setState({ datasets: [ds], activeId: "d1" });

    useApp.getState().resetCorrections("d1");

    const after = useApp.getState().datasets[0];
    expect(after.data.labels).toEqual(["m", "2m"]);
    expect(after.data.values).toEqual([
      [10, 20],
      [20, 40],
      [30, 60],
    ]);
  });
});
