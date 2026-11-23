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
    // At open nothing was edited, so the message claims nothing about edits.
    expect(s.status).toBe("Worksheet editing failed to load. Reload to try again.");
    expect(dangerToasts()).toEqual([s.status]);
    expect(s.datasets).toBe(before);
    expect(s.history).toHaveLength(0);
  });
});

const REFUSED = "Worksheet editing failed to load; nothing was changed. Reload to try again.";

/** Fail the first load (a warm, as the worksheet does at open). */
async function failWarm(): Promise<void> {
  vi.doMock("./cellEditRun", () => {
    throw new Error("network error");
  });
  await warmCellEdit();
  useToasts.setState({ toasts: [] });
  useApp.setState({ status: "" });
}
const settleBackground = () => new Promise((r) => setTimeout(r, 20));

describe("after a failed load the slice fails closed", () => {
  it("refuses a cold call, applies nothing even when the background retry then succeeds, and reports once", async () => {
    await failWarm();
    const before = useApp.getState().datasets;
    const { setCellValue, setCellBlock, insertRows, deleteRows } = useApp.getState();

    setCellValue("d1", 0, 0, 99);
    expect(useApp.getState().status).toBe(REFUSED);
    setCellBlock("d1", [{ row: 1, col: 0, value: 5 }], "paste");
    insertRows("d1", 0, 2);
    deleteRows("d1", [0, 1]);
    expect(dangerToasts()).toEqual([REFUSED]); // one toast for the episode

    // Let the retries succeed: the refused calls must NOT run late.
    vi.doUnmock("./cellEditRun");
    await warmCellEdit();
    await settleBackground();
    expect(useApp.getState().datasets).toBe(before);
    expect(useApp.getState().history).toHaveLength(0);
    expect(dangerToasts()).toEqual([REFUSED]);
  });

  it("does not stack refusals across failed retries, and edits are synchronous again after a re-warm", async () => {
    await failWarm();
    useApp.getState().setCellValue("d1", 0, 0, 1);
    await settleBackground(); // the background retry fails quietly
    useApp.getState().setCellValue("d1", 0, 0, 2);
    await settleBackground();
    expect(dangerToasts()).toEqual([REFUSED]);
    expect(useApp.getState().datasets[0].data.values[0][0]).toBe(10);

    vi.doUnmock("./cellEditRun");
    useApp.getState().setCellValue("d1", 0, 0, 3); // kicks a warming retry that now succeeds
    await warmCellEdit();
    useApp.getState().setCellValue("d1", 2, 0, 5);
    expect(useApp.getState().datasets[0].data.values[2][0]).toBe(5); // synchronous
    expect(useApp.getState().datasets[0].data.values[0][0]).toBe(10); // the refused write never landed
  });

  it("setColumnValuesRun cannot double-apply: a refused write is an error result and nothing runs later", async () => {
    await failWarm();
    const { applySetColumnValues } = await import("./setColumnValuesRun");
    const res = await applySetColumnValues("d1", { target: { kind: "column", col: 0 }, name: "", range: { from: 1, to: 3 }, expr: "7" });
    expect(res).toEqual({ ok: false, error: REFUSED }); // the history-mark check sees no entry: no second apply
    vi.doUnmock("./cellEditRun");
    await warmCellEdit();
    await settleBackground();
    expect(useApp.getState().datasets[0].data.values.map((r) => r[0])).toEqual([10, 20, 30]);
    expect(useApp.getState().history).toHaveLength(0);
  });
});
