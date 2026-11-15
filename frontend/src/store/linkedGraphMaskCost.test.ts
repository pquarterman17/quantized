// Gap audit 3 N2 review: the graph-mask bookkeeping costs nothing on an edit
// that does not touch the mask -- no re-serializing a large mask per keystroke.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { plotSelectedTogether } from "../lib/plotSelectedTogether";
import type { Dataset } from "../lib/types";
import { flushLinkedCurves } from "./linkedCurvesSync";
import { useApp } from "./useApp";

const N = 5000;
const sheet = (id: string): Dataset => ({
  id, name: id,
  data: { time: Array.from({ length: N }, (_, r) => r), values: Array.from({ length: N }, (_, r) => [r]), labels: ["Y"], units: [""], metadata: {} },
  excludedRows: Array.from({ length: N / 2 }, (_, r) => 2 * r),
});

beforeEach(async () => {
  useApp.setState({ datasets: [sheet("a"), sheet("b"), { ...sheet("other"), excludedRows: undefined }], selectedIds: [], history: [], future: [] });
  await plotSelectedTogether(["a", "b"]);
  flushLinkedCurves();
});
afterEach(() => vi.restoreAllMocks());

describe("graph mask bookkeeping cost", () => {
  it("an unrelated edit serializes no mask", () => {
    const spy = vi.spyOn(JSON, "stringify");
    for (let i = 0; i < 5; i++) {
      useApp.setState((st) => ({ datasets: st.datasets.map((d) => (d.id === "other" ? { ...d, name: `other ${i}` } : d)) }));
      flushLinkedCurves();
    }
    const bigArrays = spy.mock.calls.filter(([v]) => Array.isArray(v) && v.length >= N / 2);
    expect(bigArrays).toHaveLength(0);
    expect(useApp.getState().datasets.find((d) => d.linkedCurves)!.excludedRows).toHaveLength(N);
  });
});
