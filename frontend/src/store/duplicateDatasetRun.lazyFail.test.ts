// `duplicateDataset` loads its body (store/duplicateDatasetRun.ts) on the first
// Duplicate (bundle diet slice 28, plans/BUNDLE_HEADROOM.md). A body that will
// not load is reported and duplicates nothing. Its own file because
// `vi.doMock` must be registered before the body's first load.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct, Dataset } from "../lib/types";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";

const base: DataStruct = { time: [1, 2, 3], values: [[10], [20], [30]], labels: ["m"], units: ["emu"], metadata: {} };
const ds = (id: string): Dataset => ({ id, name: `${id}.dat`, data: base });

beforeEach(() => {
  useToasts.setState({ toasts: [] });
  useApp.setState({ datasets: [ds("d1")], activeId: "d1", history: [], future: [], status: "" });
});

afterEach(() => {
  vi.doUnmock("./duplicateDatasetRun");
});

describe("duplicateDataset: the body's chunk will not load", () => {
  it("reports it and duplicates nothing", async () => {
    vi.doMock("./duplicateDatasetRun", () => {
      throw new Error("network error");
    });
    const before = useApp.getState();

    await useApp.getState().duplicateDataset("d1");

    const s = useApp.getState();
    expect(s.status).toMatch(/^Duplicate failed to load: .+/);
    expect(useToasts.getState().toasts.filter((t) => t.kind === "danger").map((t) => t.msg)).toEqual([s.status]);
    expect(s.datasets).toBe(before.datasets);
    expect(s.history).toHaveLength(0);
  });
});
