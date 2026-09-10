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

// BUG-006 site 10, the .dwk half. `lib/workspaceSerialize.ts` stores `metadata`
// wholesale and `pending` independently, so a document written by a build
// without the import-path strip can restore a SAMPLED preview still carrying a
// full-length row-indexed sidecar. These two assignments (here and
// store/importDatasets.ts) are the only places a dataset gains `pending`, so
// stripping at both is what makes the invariant an invariant.
describe("a restored SAMPLED pending dataset drops its row-indexed sidecars (BUG-006 site 10)", () => {
  const SIDECAR = { Group: ["A0", "A0", "B1", "B1", "C2", "C2"] };
  const stored = (previewSampled: boolean) => ({
    id: "d1",
    name: "book.opj",
    data: {
      time: [1, 2, 4, 5],
      values: [[0], [1], [2], [2]],
      labels: ["Group"],
      units: [""],
      metadata: { text_columns: SIDECAR, origin_text_columns: SIDECAR, instrument: "PPMS" },
    },
    pending: { kind: "path", path: "/p.opj", bookId: "b1", rows: 6, cols: 1, previewSampled },
  });

  it("strips them when the stored preview was SAMPLED", () => {
    const ds = parseWorkspaceDataset(stored(true), 0);
    expect(ds?.pending).toBeDefined();
    expect(ds?.data.metadata?.["text_columns"]).toBeUndefined();
    expect(ds?.data.metadata?.["origin_text_columns"]).toBeUndefined();
    // A targeted strip: everything else survives.
    expect(ds?.data.metadata?.["instrument"]).toBe("PPMS");
  });

  it("keeps them for a padding-TRIMMED preview, whose cells line up", () => {
    const ds = parseWorkspaceDataset(stored(false), 0);
    expect(ds?.data.metadata?.["text_columns"]).toEqual(SIDECAR);
  });

  it("strips them when an older .dwk omits the flag entirely — fail CLOSED", () => {
    // `rowsAreSampled` treats `previewSampled !== false` as sampled, so an
    // absent flag is the conservative case: a wrong label is worse than a
    // numeric one.
    const withoutFlag = stored(true);
    delete (withoutFlag.pending as { previewSampled?: boolean }).previewSampled;
    const ds = parseWorkspaceDataset(withoutFlag, 0);
    expect(ds?.data.metadata?.["text_columns"]).toBeUndefined();
  });
});
