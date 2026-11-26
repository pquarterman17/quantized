// Bundle diet slice 35: the removeFormula body (store/removeFormulaRun.ts) loads
// on demand. A removal that beats the load runs when it lands; a body that will
// not load is reported and removes nothing. Its own file because `vi.doMock`
// must be registered before the body's first load.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct, Dataset } from "../lib/types";
import { resetRemoveFormulaForTests, warmRemoveFormula } from "./removeFormulaLazy";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";

const base: DataStruct = { time: [1, 2, 3], values: [[10], [20], [30]], labels: ["m"], units: ["emu"], metadata: {} };
const ds = (id: string): Dataset => ({ id, name: `${id}.dat`, data: base });
const dangerToasts = () => useToasts.getState().toasts.filter((t) => t.kind === "danger").map((t) => t.msg);

beforeEach(async () => {
  useToasts.setState({ toasts: [] });
  useApp.setState({ datasets: [ds("d1")], activeId: "d1", history: [], future: [], status: "" });
  await warmRemoveFormula();
  expect(useApp.getState().addFormula("d1", "twice", "A*2")).toBe(true);
  expect(useApp.getState().datasets[0].formulas).toHaveLength(1);
  resetRemoveFormulaForTests();
});

afterEach(async () => {
  vi.doUnmock("./removeFormulaRun");
  resetRemoveFormulaForTests();
  await warmRemoveFormula(); // leave the slice warm for whatever runs next in this worker
});

describe("the computed-column removal body loads on demand", () => {
  it("a removal made before the load lands runs once it has", async () => {
    useApp.getState().removeFormula("d1", 0);
    expect(useApp.getState().datasets[0].formulas).toHaveLength(1); // the body is not in yet

    await warmRemoveFormula();
    await vi.waitFor(() => expect(useApp.getState().datasets[0].formulas).toBeUndefined());
    expect(useApp.getState().datasets[0].data.labels).toEqual(["m"]);
  });

  it("is synchronous once warm", async () => {
    await warmRemoveFormula();
    useApp.getState().removeFormula("d1", 0);
    expect(useApp.getState().datasets[0].formulas).toBeUndefined();
  });

  it("a body that will not load is reported once and removes nothing", async () => {
    vi.doMock("./removeFormulaRun", () => {
      throw new Error("network error");
    });
    const before = useApp.getState().datasets;

    useApp.getState().removeFormula("d1", 0);
    await warmRemoveFormula();

    const s = useApp.getState();
    expect(s.status).toBe("Removing a computed column failed to load. Reload to try again.");
    expect(dangerToasts()).toEqual([s.status]);
    expect(s.datasets).toBe(before);
  });
});
