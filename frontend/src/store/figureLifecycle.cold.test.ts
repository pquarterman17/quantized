// Bundle diet slice 36: the figure lifecycle's session, promotion and
// Library-figure bodies (store/figureLifecycleRun.ts) load on demand. A call
// that beats the load runs when it lands, in call order; a body that will not
// load is reported and changes nothing. Its own file because `vi.doMock` must
// be registered before the bodies' first load.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFigureDocument, type FigureDocument } from "../lib/figureDocument";
import { defaultPlotView } from "../lib/plotview";
import { SESSION_BUSY_MSG } from "./figureLifecycle";
import { resetFigureLifecycleForTests, warmFigureLifecycle } from "./figureLifecycleLazy";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";

const figure = (id: string, name: string): FigureDocument =>
  createFigureDocument({ id, name, datasetId: "d1", view: defaultPlotView() });
const dangerToasts = () => useToasts.getState().toasts.filter((t) => t.kind === "danger").map((t) => t.msg);

beforeEach(async () => {
  await warmFigureLifecycle();
  useToasts.setState({ toasts: [] });
  useApp.setState({
    datasets: [{ id: "d1", name: "Data", data: { time: [0, 1], values: [[2, 3]], labels: ["Y"], units: [""], metadata: {} } }],
    activeId: "d1",
    editableFigures: [figure("f1", "First")],
    figurePublicationSession: null,
    figureBuilderOpen: false,
    history: [],
    future: [],
    status: "",
  });
  resetFigureLifecycleForTests();
});

afterEach(async () => {
  vi.doUnmock("./figureLifecycleRun");
  resetFigureLifecycleForTests();
  await warmFigureLifecycle(); // leave the slice warm for whatever runs next in this worker
});

describe("the figure lifecycle bodies load on demand", () => {
  it("calls made before the load lands run, in order, once it has", async () => {
    useApp.getState().renameEditableFigure("f1", "Renamed");
    useApp.getState().deleteEditableFigure("f1");
    expect(useApp.getState().editableFigures.map((f) => f.name)).toEqual(["First"]); // the bodies are not in yet

    await warmFigureLifecycle();
    await vi.waitFor(() => expect(useApp.getState().editableFigures).toEqual([]));
    expect(useApp.getState().history.map((h) => h.label)).toEqual(["rename figure", "delete figure"]);
  });

  it("is synchronous once warm, and returns the body's own result", async () => {
    await warmFigureLifecycle();
    const copyId = useApp.getState().duplicateEditableFigure("f1");
    expect(copyId).toEqual(expect.any(String));
    expect(useApp.getState().editableFigures.map((f) => f.name)).toEqual(["First", "First copy"]);
    expect(useApp.getState().beginFigurePublicationEditForFigure("f1")).toBe(true);
    expect(useApp.getState().beginFigurePublicationEditForFigure("f1")).toBe(false); // a session is already open
    expect(useApp.getState().status).toBe(SESSION_BUSY_MSG);
  });

  it("a body that will not load is reported once and changes nothing", async () => {
    vi.doMock("./figureLifecycleRun", () => {
      throw new Error("network error");
    });
    const before = useApp.getState().editableFigures;

    useApp.getState().deleteEditableFigure("f1");
    await warmFigureLifecycle();

    const s = useApp.getState();
    expect(s.status).toBe("Figure tools failed to load. Reload to try again.");
    expect(dangerToasts()).toEqual([s.status]);
    expect(s.editableFigures).toBe(before);
  });
});
