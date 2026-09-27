// Review finding 8: store/computedColumns.refreshFitRefsLater's eager
// guard — no dynamic import (and no dropped rejection) when a dataset has
// no fit()/fitval() column to refresh. Isolated in its own file (not
// computedColumns.test.ts) so mocking "./fitRefsRun" here can't shadow the
// real resolution other tests exercise.

import { describe, expect, it, vi } from "vitest";

import type { ComputedColumn, Dataset } from "../lib/types";
import { refreshFitRefsLater } from "./computedColumns";

// Architecture's weak-wait ratchet wants a resolved STATE waited on, not a
// mock call — so the stub writes its argument into a plain variable and
// every wait below reads THAT, not `refreshFitRefsFor.mock.calls`.
let seenId: string | null = null;
vi.mock("./fitRefsRun", () => ({ refreshFitRefsFor: (id: string) => void (seenId = id) }));

function ds(formulas: ComputedColumn[] | undefined): Dataset {
  return {
    id: "d",
    name: "d",
    data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} },
    formulas,
  };
}

describe("refreshFitRefsLater", () => {
  it("never imports fitRefsRun when nothing on the dataset could need it", async () => {
    seenId = null;
    const get = () => ({ datasets: [ds([{ name: "P", expr: "A * 2", deps: ["A"] }])], setStatus: vi.fn() }) as never;
    refreshFitRefsLater("d", get);
    await new Promise((r) => setTimeout(r, 10)); // let a real import settle if one fired
    expect(seenId).toBeNull();
  });

  it("still imports when a column has a fit()/fitval() reference, even with no snapshot yet", async () => {
    seenId = null;
    const get = () => ({ datasets: [ds([{ name: "P", expr: 'fitval("Gaussian", x)', deps: [] }])], setStatus: vi.fn() }) as never;
    refreshFitRefsLater("d", get);
    await vi.waitFor(() => expect(seenId).toBe("d"));
  });

  it("also imports when a column already carries a fit snapshot", async () => {
    seenId = null;
    const withFits: ComputedColumn = { name: "P", expr: 'fit("Gaussian", "A")', deps: [], derived: { fits: [{ model: "Gaussian", paramNames: ["A"], params: [1] }] } };
    const get = () => ({ datasets: [ds([withFits])], setStatus: vi.fn() }) as never;
    refreshFitRefsLater("d", get);
    await vi.waitFor(() => expect(seenId).toBe("d"));
  });

  it("a missing dataset id is also a no-op, never a throw", () => {
    const get = () => ({ datasets: [], setStatus: vi.fn() }) as never;
    expect(() => refreshFitRefsLater("ghost", get)).not.toThrow();
  });
});
