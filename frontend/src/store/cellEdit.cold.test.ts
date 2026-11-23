// Bundle diet slice 32: the cell-edit bodies (store/cellEditRun.ts) load on
// demand. A write that beats the load runs when it lands, in order; a body
// that will not load is reported and edits nothing. Its own file because
// `vi.doMock` must be registered before the body's first load.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct, Dataset } from "../lib/types";
import { resetCellEditForTests, warmCellEdit } from "./cellEdit";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";

const base: DataStruct = { time: [1, 2, 3], values: [[10], [20], [30]], labels: ["m"], units: ["emu"], metadata: {} };
const ds = (id: string): Dataset => ({ id, name: `${id}.dat`, data: base });
const dangerToasts = () => useToasts.getState().toasts.filter((t) => t.kind === "danger").map((t) => t.msg);

beforeEach(() => {
  useToasts.setState({ toasts: [] });
  useApp.setState({ datasets: [ds("d1")], activeId: "d1", history: [], future: [], status: "" });
  resetCellEditForTests();
});

afterEach(async () => {
  vi.doUnmock("./cellEditRun");
  resetCellEditForTests();
  await warmCellEdit(); // leave the slice warm for whatever runs next in this worker
});

describe("cell edit bodies load on demand", () => {
  it("a write made before the load lands runs once it has, and a second one runs after it", async () => {
    useApp.getState().setCellValue("d1", 0, 0, 99);
    useApp.getState().setCellValue("d1", 1, 0, 77);
    // Nothing yet: the bodies are not in.
    expect(useApp.getState().datasets[0].data.values[0][0]).toBe(10);

    await warmCellEdit();
    await vi.waitFor(() => expect(useApp.getState().datasets[0].data.values[1][0]).toBe(77));
    const values = useApp.getState().datasets[0].data.values;
    expect(values[0][0]).toBe(99);
    expect(values[2][0]).toBe(30);
  });

  it("is synchronous once warm", async () => {
    await warmCellEdit();
    useApp.getState().setCellValue("d1", 2, 0, 5);
    expect(useApp.getState().datasets[0].data.values[2][0]).toBe(5);
  });

  it("a body that will not load is reported once and edits nothing", async () => {
    vi.doMock("./cellEditRun", () => {
      throw new Error("network error");
    });
    const before = useApp.getState().datasets;

    useApp.getState().setCellValue("d1", 0, 0, 99);
    useApp.getState().insertRows("d1", 0, 1);
    await warmCellEdit();

    const s = useApp.getState();
    expect(s.status).toMatch(/^Cell editing failed to load: .+ — nothing was changed$/);
    expect(dangerToasts()).toEqual([s.status]);
    expect(s.datasets).toBe(before);
    expect(s.history).toHaveLength(0);
  });
});
