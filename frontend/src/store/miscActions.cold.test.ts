// Bundle diet slice 37: seven worksheet / Library / Quick Plot action bodies
// (store/miscActionsRun.ts) load on demand. A call that beats the load runs
// when it lands, in call order; a warm call is synchronous and returns the
// body's own value; a body that will not load is reported and changes nothing.
// Its own file because `vi.doMock` must be registered before the first load.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetMiscActionsForTests, warmMiscActions } from "./miscActionsLazy";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";

const sheet = (id: string, name: string, workbookId: string) => ({
  id,
  name,
  workbookId,
  data: { time: [0, 1], values: [[2, 3]], labels: ["Y"], units: [""], metadata: {} },
});
const dangerToasts = () => useToasts.getState().toasts.filter((t) => t.kind === "danger").map((t) => t.msg);

beforeEach(async () => {
  await warmMiscActions();
  useToasts.setState({ toasts: [] });
  useApp.setState({
    datasets: [sheet("a", "A", "w1"), sheet("b", "B", "w2")],
    workbooks: [{ id: "w1", name: "One" }, { id: "w2", name: "Two" }],
    activeId: "a",
    history: [],
    future: [],
    status: "",
  });
  resetMiscActionsForTests();
});

afterEach(async () => {
  vi.doUnmock("./miscActionsRun");
  resetMiscActionsForTests();
  await warmMiscActions(); // leave the slice warm for whatever runs next in this worker
});

describe("the worksheet and Library action bodies load on demand", () => {
  it("a call made before the load lands runs once it has", async () => {
    useApp.getState().combineWorkbooks({ workbookIds: [], worksheetIds: ["a", "b"] }, "Both");
    expect(useApp.getState().workbooks.map((w) => w.name)).toEqual(["One", "Two"]); // the bodies are not in yet

    await warmMiscActions();
    await vi.waitFor(() => expect(useApp.getState().workbooks.map((w) => w.name)).toEqual(["One", "Two", "Both"]));
    expect(useApp.getState().history.map((h) => h.label)).toEqual(["combine workbooks"]);
  });

  it("is synchronous once warm, and returns the body's own result", async () => {
    await warmMiscActions();
    const id = useApp.getState().combineWorkbooks({ workbookIds: [], worksheetIds: ["a", "b"] }, "Both");
    expect(id).toEqual(expect.any(String));
    expect(useApp.getState().datasets.every((d) => d.workbookId === id)).toBe(true);
    expect(useApp.getState().combineWorkbooks({ workbookIds: [], worksheetIds: [] }, "Nothing")).toBeNull(); // a refusal
    expect(useApp.getState().status).toBe("Combine unavailable: nothing selected");
  });

  it("a body that will not load is reported once and changes nothing", async () => {
    vi.doMock("./miscActionsRun", () => {
      throw new Error("network error");
    });
    const before = useApp.getState().workbooks;

    useApp.getState().combineWorkbooks({ workbookIds: [], worksheetIds: ["a"] }, "Both");
    await warmMiscActions();

    const s = useApp.getState();
    expect(s.status).toBe("Worksheet and figure tools failed to load. Reload to try again.");
    expect(dangerToasts()).toEqual([s.status]);
    expect(s.workbooks).toBe(before);
  });
});
