// recomputeStaleDatasets' partial-outcome report. store/recalc.test.ts pins
// that a failed re-derivation STAYS stale and that each failure path leaves a
// visible status; this file pins what that status says once several stale
// datasets settle in one pass: how many succeeded, and which ones failed and
// why — by NAME, not id (pattern: store/reimportAllRun.ts's summary toast).
// Without it, each per-dataset message overwrote the last, so a pass that
// re-derived two and refused one read exactly like a pass that refused all.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset, DataStruct } from "../lib/types";
import { useApp } from "./useApp";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  applyCorrections: vi.fn(),
}));

const data = (): DataStruct => ({ time: [0, 1], values: [[1], [2]], labels: ["v"], units: [""], metadata: {} });

const ds = (id: string, name: string, over: Partial<Dataset> = {}): Dataset => ({ id, name, data: data(), ...over });

const corrected = (id: string, name: string, bg: string): Dataset =>
  ds(id, name, { raw: data(), corrections: {}, bgRef: { datasetId: bg, interp: "linear" } });

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ datasets: [], activeId: null, recalcMode: "manual", staleDatasets: [], staleFits: [], status: "" });
});

describe("recomputeStaleDatasets reports the partial outcome", () => {
  it("names each failed dataset with its reason, counts the rest as recalculated, and blames a downstream on its source", async () => {
    useApp.setState({
      datasets: [
        ds("a", "Alpha"),
        corrected("b", "Bravo", "a"),
        corrected("c", "Charlie", "b"),
        corrected("d", "Delta", "a"),
      ],
      staleDatasets: ["c", "b", "d"],
      // Bravo's correction is refused (a `false` with no status of its own);
      // Charlie depends on it; Delta is fine.
      applyCorrections: async (id: string) => id !== "b",
    } as never);

    await useApp.getState().recalcNow();

    expect(useApp.getState().staleDatasets).toEqual(["c", "b"]);
    expect(useApp.getState().status).toBe(
      "recalculated 1 of 3 datasets — Bravo: correction refused; Charlie: its source Bravo failed",
    );
  });

  it("carries the derived-worksheet failure's own message, next to the successes", async () => {
    useApp.setState({
      datasets: [
        ds("a", "Alpha"),
        ds("g", "Ghosted", { derivedFrom: { datasetId: "ghost", pipeline: "x" }, corrections: {} }),
        corrected("d", "Delta", "a"),
      ],
      staleDatasets: ["g", "d"],
      applyCorrections: async () => true,
    } as never);

    await useApp.getState().recalcNow();

    expect(useApp.getState().staleDatasets).toEqual(["g"]);
    expect(useApp.getState().status).toMatch(/^recalculated 1 of 2 datasets — Ghosted: derived worksheet recompute failed: .+/);
  });

  it("says nothing extra when every stale dataset settles", async () => {
    useApp.setState({
      datasets: [ds("a", "Alpha"), corrected("d", "Delta", "a")],
      staleDatasets: ["d"],
      applyCorrections: async () => true,
      status: "",
    } as never);

    await useApp.getState().recalcNow();

    expect(useApp.getState().staleDatasets).toEqual([]);
    expect(useApp.getState().status).toBe("");
  });
});
