// `applyCorrections` and `applyCorrectionsToMany` load their bodies
// (store/correctionsRun.ts) on first use (bundle diet slice 21,
// plans/BUNDLE_HEADROOM.md). A body that will not load is reported and
// applies nothing; the next apply retries the load. The synchronous refusals
// stay in the slice and still answer before any load. Its own file because
// `vi.doMock` must be registered before the body's first load.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyCorrections as applyCorrectionsApi, type CorrectionsRequest } from "../lib/api";
import type { DataStruct, Dataset } from "../lib/types";
import { resetCorrectionsRunForTests } from "./corrections";
import { useToasts } from "./toasts";
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

const base: DataStruct = { time: [1, 2, 3], values: [[10], [20], [30]], labels: ["m"], units: ["emu"], metadata: {} };
const ds = (id: string, extra: Partial<Dataset> = {}): Dataset => ({ id, name: `${id}.dat`, data: base, ...extra });

const doubled = (req: CorrectionsRequest): Promise<DataStruct> =>
  Promise.resolve({ ...req.dataset, values: req.dataset.values.map((row) => row.map((v) => v * 2)) });

const dangerToasts = () => useToasts.getState().toasts.filter((t) => t.kind === "danger").map((t) => t.msg);

beforeEach(() => {
  vi.mocked(applyCorrectionsApi).mockReset();
  vi.mocked(applyCorrectionsApi).mockImplementation(doubled);
  resetCorrectionsRunForTests();
  useToasts.setState({ toasts: [] });
  useApp.setState({
    datasets: [ds("d1", { corrections: { yOff: 5 } }), ds("d2")],
    activeId: "d1",
    history: [],
    future: [],
    status: "",
  });
});

afterEach(() => {
  vi.doUnmock("./correctionsRun");
});

const failLoad = () =>
  vi.doMock("./correctionsRun", () => {
    throw new Error("network error");
  });

describe("applyCorrections: the body's chunk will not load", () => {
  it("reports it and applies nothing", async () => {
    failLoad();
    const before = useApp.getState();

    expect(await useApp.getState().applyCorrections("d2", { yOff: 5 })).toBe(false);

    const s = useApp.getState();
    expect(s.status).toMatch(/^Corrections failed to load: .+/);
    expect(dangerToasts()).toEqual([s.status]);
    expect(s.datasets).toBe(before.datasets);
    expect(s.history).toHaveLength(0);
    expect(applyCorrectionsApi).not.toHaveBeenCalled();
  });

  it("retries the load on the next apply instead of staying broken", async () => {
    failLoad();
    expect(await useApp.getState().applyCorrections("d2", { yOff: 5 })).toBe(false);

    // A rejected dynamic import is not cached, so the next call refetches.
    vi.doUnmock("./correctionsRun");
    vi.resetModules();
    expect(await useApp.getState().applyCorrections("d2", { yOff: 5 })).toBe(true);
    expect(useApp.getState().datasets[1].data.values).toEqual([[20], [40], [60]]);
  });

  it("still refuses a derived worksheet synchronously, before any load", () => {
    failLoad();
    useApp.setState({ datasets: [ds("der", { derivedFrom: { datasetId: "d1", pipeline: "p" } })] });

    void useApp.getState().applyCorrections("der", { yOff: 5 });

    expect(useApp.getState().status).toMatch(/is a derived worksheet/);
  });
});

describe("applyCorrectionsToMany: the body's chunk will not load", () => {
  it("reports it, applies to no target and counts none", async () => {
    failLoad();
    const before = useApp.getState();

    expect(await useApp.getState().applyCorrectionsToMany("d1", ["d2"])).toBe(0);

    const s = useApp.getState();
    expect(s.status).toMatch(/^Corrections failed to load: .+/);
    expect(dangerToasts()).toEqual([s.status]);
    expect(s.datasets).toBe(before.datasets);
    expect(applyCorrectionsApi).not.toHaveBeenCalled();
  });

  it("still refuses a source without corrections synchronously, before any load", () => {
    failLoad();

    void useApp.getState().applyCorrectionsToMany("d2", ["d1"]);

    expect(useApp.getState().status).toBe("no corrections on the source dataset to copy");
  });
});
