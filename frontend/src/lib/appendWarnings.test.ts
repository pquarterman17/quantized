// P2.5 review finding 4 — `analyzeMerge`'s "missing-columns" row count must
// match the row count `mergeDatasets` (lib/merge.ts) actually pads that input
// to (`sidecarRowCount`), not the bare `max(time, values)` a text-only or
// sidecar-padded input can run longer than.

import { describe, expect, it } from "vitest";

import { analyzeMerge } from "./appendWarnings";
import { mergeDatasets } from "./merge";
import type { DataStruct } from "./types";

describe("analyzeMerge — missing-columns row count matches mergeDatasets' own span", () => {
  it("counts the sidecar's row span, not the numeric grid, when the sidecar runs longer", () => {
    // A numeric grid of 1 row, but a text sidecar with 3 — `mergeDatasets`
    // pads this part's NUMERIC rows out to 3 (sidecarRowCount), so a warning
    // that said "its row is" (singular, from the bare 1-row grid) would
    // undercount what actually goes blank.
    const withSidecar: DataStruct = {
      time: [1],
      values: [[10]],
      labels: ["M"],
      units: ["emu"],
      metadata: { text_columns: { Notes: ["a", "b", "c"] } },
    };
    const other: DataStruct = { time: [5], values: [[50, 500]], labels: ["M", "T"], units: ["emu", "K"], metadata: {} };
    const w = analyzeMerge([withSidecar, other], ["w.dat", "o.dat"], "name");
    const missing = w.find((x) => x.code === "missing-columns" && x.text.startsWith("w.dat"));
    expect(missing?.text).toBe('w.dat has no "T" column; its 3 rows are left blank (NaN) there.');
    // Prove it against the real merge, not just the sidecar-length number:
    // mergeDatasets pads withSidecar to 3 rows too.
    const merged = mergeDatasets([withSidecar, other], ["w.dat", "o.dat"], "name");
    expect(merged.time).toHaveLength(4); // 3 (padded) + 1
  });

  it("a text-only part (no numeric rows at all) is still counted by its sidecar span", () => {
    const textOnly: DataStruct = { time: [], values: [], labels: [], units: [], metadata: { text_columns: { ID: ["s1", "s2"] } } };
    const other: DataStruct = { time: [0], values: [[1]], labels: ["v"], units: [""], metadata: {} };
    const w = analyzeMerge([textOnly, other], ["t.dat", "o.dat"], "name");
    expect(w.find((x) => x.text.startsWith("t.dat"))?.text).toBe('t.dat has no "v" column; its 2 rows are left blank (NaN) there.');
  });

  it("unaffected when there is no sidecar padding (the ordinary case)", () => {
    const a: DataStruct = { time: [1, 2], values: [[10], [11]], labels: ["M"], units: ["emu"], metadata: {} };
    const b: DataStruct = { time: [3], values: [[30, 300]], labels: ["M", "T"], units: ["emu", "K"], metadata: {} };
    const w = analyzeMerge([a, b], ["a.dat", "b.dat"], "name");
    expect(w.find((x) => x.text.startsWith("a.dat"))?.text).toBe('a.dat has no "T" column; its 2 rows are left blank (NaN) there.');
  });
});
