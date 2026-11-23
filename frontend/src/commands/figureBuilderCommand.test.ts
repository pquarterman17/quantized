import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { withCommandDocs } from "./commandDocs";
import { buildFileCommands, figureViewSettled } from "./fileCommands";
import { fuzzy } from "../lib/fuzzy";
import { defaultPlotView } from "../lib/plotview";
import { useApp } from "../store/useApp";

// UX-H: "Export figure…" routes views the preview cannot draw to the quick
// dialog, which is lazily imported — stub it so no dialog opens.
const quick = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../lib/exportFigureCommand", () => ({ runExportFigureCommand: quick.run }));

// The Plot menu's export and preview openers load on the first pick (bundle diet
// slice 32). Load the module up front; each test then awaits the opener
// (runAndSettle -> figureViewSettled) and asserts, never polling a timer or a mock.
beforeAll(async () => {
  await import("../lib/exportFigureView");
});

/** Run a command and wait for its lazy opener to settle (`figureViewSettled`). */
const runAndSettle = async (command: { run: () => void } | undefined): Promise<void> => {
  command?.run();
  await figureViewSettled();
};

// F2.1e fixture: minimal dataset shared by the no-focused-window canonical
// tests below -- shape mirrors figureLifecycle.test.ts's own fixture.
const twoChannels = () => ({
  id: "d1",
  name: "Two channels",
  data: { time: [0, 1, 2], values: [[1, 4], [2, 5], [3, 6]], labels: ["A", "B"], units: ["", ""], metadata: {} },
});
const sampleDataset = () => ({
  id: "d1",
  name: "Sample data",
  data: { time: [0, 1, 2], values: [[1, 2, 3]], labels: ["Y"], units: [""], metadata: {} },
});

// The real store actions, captured once before any test replaces them with a
// spy -- restored every beforeEach so a mock one test installs (setStatus,
// setFigureBuilderOpen, beginFigurePublicationEdit) can never leak into a
// later test that never meant to touch it.
const REAL_ACTIONS = {
  setStatus: useApp.getState().setStatus,
  setFigureBuilderOpen: useApp.getState().setFigureBuilderOpen,
  beginFigurePublicationEdit: useApp.getState().beginFigurePublicationEdit,
};

describe("Publication Preview command", () => {
  // This file has no store reset between tests (the module-singleton `useApp`
  // persists for the whole file) -- pin the fields this command reads/writes
  // to a known baseline before every test so one test's dataset/session/mock
  // never leaks into the next.
  beforeEach(() => {
    useApp.setState({
      ...defaultPlotView(),
      ...REAL_ACTIONS,
      figurePublicationSession: null,
      figureBuilderOpen: false,
      datasets: [],
      activeId: null,
      editableFigures: [],
    });
  });

  it("opens a canonical detached session from the active dataset when no window is focused", async () => {
    const setFigureBuilderOpen = vi.fn();
    const beginFigurePublicationEdit = vi.fn().mockReturnValue(false);
    const setStatus = vi.fn();
    useApp.setState({
      datasets: [sampleDataset()],
      activeId: "d1",
      xKey: 0,
      yKeys: [0],
      setFigureBuilderOpen,
      beginFigurePublicationEdit,
      setStatus,
    });
    const command = withCommandDocs(buildFileCommands(useApp.getState)).find((item) => item.id === "figure-builder");

    expect(command).toMatchObject({
      label: "Publication preview…",
      description: expect.stringContaining("Apply updates that figure"),
    });

    await runAndSettle(command);
    expect(beginFigurePublicationEdit).toHaveBeenCalled();
    // Apply is now available from this entry point -- the legacy no-Apply
    // opener must NOT fire once a canonical detached session opened instead.
    expect(setFigureBuilderOpen).not.toHaveBeenCalled();
    expect(useApp.getState().figurePublicationSession).toMatchObject({
      target: "new-editable",
      windowId: null,
      draft: { name: "Sample data", bindings: { datasetId: "d1", xKey: 0, yKeys: [0] } },
    });
    expect(useApp.getState().figureBuilderOpen).toBe(true);
    expect(setStatus).toHaveBeenCalledWith(
      'no plot window is focused — previewing "Sample data"; Apply will save it as a new editable figure',
    );
  });

  it("falls back to the legacy no-Apply preview when neither a window nor a dataset is available", async () => {
    const setFigureBuilderOpen = vi.fn();
    const beginFigurePublicationEdit = vi.fn().mockReturnValue(false);
    const setStatus = vi.fn();
    useApp.setState({ setFigureBuilderOpen, beginFigurePublicationEdit, setStatus });
    const command = withCommandDocs(buildFileCommands(useApp.getState)).find((item) => item.id === "figure-builder");

    await runAndSettle(command);
    expect(beginFigurePublicationEdit).toHaveBeenCalled();
    expect(setStatus).toHaveBeenCalledWith(
      "no plot window is focused — previewing the active dataset; Apply is unavailable in this mode",
    );
    expect(setFigureBuilderOpen).toHaveBeenCalledWith(true);
    expect(useApp.getState().figurePublicationSession).toBeNull();
  });

  it("round-trips: Apply from the unfocused-window entry point creates exactly one new editable figure", async () => {
    const beginFigurePublicationEdit = vi.fn().mockReturnValue(false);
    useApp.setState({ datasets: [sampleDataset()], activeId: "d1", beginFigurePublicationEdit });
    const historyLength = useApp.getState().history.length;

    await runAndSettle(buildFileCommands(useApp.getState).find((item) => item.id === "figure-builder"));
    expect(useApp.getState().figurePublicationSession?.target).toBe("new-editable");

    expect(useApp.getState().applyFigurePublicationEdit()).toBe(true);
    expect(useApp.getState().editableFigures).toHaveLength(1);
    expect(useApp.getState().editableFigures[0]).toMatchObject({ name: "Sample data", bindings: { datasetId: "d1" } });
    expect(useApp.getState().figurePublicationSession).toBeNull();
    expect(useApp.getState().figureBuilderOpen).toBe(false);
    expect(useApp.getState().history).toHaveLength(historyLength + 1);

    useApp.getState().undo();
    expect(useApp.getState().editableFigures).toEqual([]);
  });

  it("begins a canonical focused-window session before falling back", async () => {
    const setFigureBuilderOpen = vi.fn();
    const beginFigurePublicationEdit = vi.fn().mockReturnValue(true);
    useApp.setState({ setFigureBuilderOpen, beginFigurePublicationEdit });
    await runAndSettle(buildFileCommands(useApp.getState).find((item) => item.id === "figure-builder"));
    expect(beginFigurePublicationEdit).toHaveBeenCalled();
    expect(setFigureBuilderOpen).not.toHaveBeenCalled();
  });

  it("preserves an active Publication Preview instead of invoking the legacy fallback", async () => {
    const setFigureBuilderOpen = vi.fn();
    const beginFigurePublicationEdit = vi.fn().mockReturnValue(false);
    const setStatus = vi.fn();
    const session = { target: "new-editable" as const, windowId: null, baseline: {} as never, draft: {} as never };
    useApp.setState({ figurePublicationSession: session, setFigureBuilderOpen, beginFigurePublicationEdit, setStatus });

    await runAndSettle(buildFileCommands(useApp.getState).find((item) => item.id === "figure-builder"));
    expect(setStatus).toHaveBeenCalledWith("finish or cancel the current Publication Preview before opening another");

    expect(beginFigurePublicationEdit).not.toHaveBeenCalled();
    expect(setFigureBuilderOpen).not.toHaveBeenCalled();
    expect(useApp.getState().figurePublicationSession).toBe(session);
    expect(setStatus).toHaveBeenCalledWith("finish or cancel the current Publication Preview before opening another");
  });

  it("identifies the multi-panel surface as a temporary export composition", async () => {
    const setFigurePageOpen = vi.fn();
    useApp.setState({ setFigurePageOpen });
    const command = withCommandDocs(buildFileCommands(useApp.getState)).find((item) => item.id === "figure-page");

    expect(command).toMatchObject({
      label: "Multi-panel export…",
      description: expect.stringContaining("Temporarily compose"),
    });

    command?.run(); // synchronous: Multi-panel export is not behind the lazy opener
    expect(setFigurePageOpen).toHaveBeenCalledWith(true);
  });

  // UX-H: one export view — Plot ▸ Export figure… opens the preview.
  // Runs the command; the caller awaits the state its path produces.
  const runExportFigure = (): Promise<void> =>
    runAndSettle(buildFileCommands(useApp.getState).find((item) => item.id === "export-figure"));
  const quickCalled = () => {
    quick.run.mockReset();
    return new Promise<void>((resolve) => quick.run.mockImplementation(async () => resolve()));
  };

  it.each([
    ["an XY plot", {}],
    ["a facet grid", { stackMode: true, facetKey: 0 }],
  ])("Export figure… opens the Publication preview for %s", async (_name, view) => {
    quick.run.mockReset();
    const beginFigurePublicationEdit = vi.fn().mockReturnValue(true);
    useApp.setState({ datasets: [sampleDataset()], activeId: "d1", beginFigurePublicationEdit, ...view });
    await runExportFigure();
    expect(beginFigurePublicationEdit).toHaveBeenCalled();
    expect(quick.run).not.toHaveBeenCalled();
  });

  it.each([
    ["statMode", { statMode: true }],
    ["polarMode", { polarMode: true }],
    ["stackMode", { stackMode: true }],
    // The Stage staggers a waterfall by the live canvas' measured span.
    ["waterfall", { waterfall: 0.2 }],
    ["waterfallDx", { waterfallDx: 0.1 }],
  ])(
    "Export figure… keeps the quick dialog for a view the preview cannot draw (%s)",
    async (_mode, view) => {
      const called = quickCalled();
      const beginFigurePublicationEdit = vi.fn().mockReturnValue(true);
      useApp.setState({ datasets: [twoChannels()], activeId: "d1", beginFigurePublicationEdit, ...view });
      await runExportFigure();
      await called;
      expect(beginFigurePublicationEdit).not.toHaveBeenCalled();
    },
  );

  it("Export figure… opens the preview for a stack of ONE channel (the Stage draws a plain plot)", async () => {
    quick.run.mockReset();
    const beginFigurePublicationEdit = vi.fn().mockReturnValue(true);
    useApp.setState({ datasets: [sampleDataset()], activeId: "d1", beginFigurePublicationEdit, stackMode: true });
    await runExportFigure();
    expect(beginFigurePublicationEdit).toHaveBeenCalled();
    expect(quick.run).not.toHaveBeenCalled();
  });

  it("Export figure… keeps the quick dialog for a spatial page composition", async () => {
    const called = quickCalled();
    const beginFigurePublicationEdit = vi.fn().mockReturnValue(true);
    useApp.setState({ datasets: [sampleDataset()], activeId: "d1", beginFigurePublicationEdit, composition: { kind: "spatial", panels: [] } as never });
    await runExportFigure();
    await called;
    expect(beginFigurePublicationEdit).not.toHaveBeenCalled();
    useApp.setState({ composition: null });
  });

  it("Export figure… on a focused plot window opens a session on THAT window", async () => {
    useApp.setState({ datasets: [sampleDataset()], activeId: "d1" });
    useApp.getState().createWindow("d1");
    const focused = useApp.getState().focusedWindowId;
    expect(focused).not.toBeNull();
    await runExportFigure();
    expect(useApp.getState().figurePublicationSession).toMatchObject({ target: "window", windowId: focused });
    expect(useApp.getState().figureBuilderOpen).toBe(true);
    useApp.getState().cancelFigurePublicationEdit();
  });

  it("Export figure… with no dataset lets the quick dialog refuse with its reason", async () => {
    const called = quickCalled();
    const setFigureBuilderOpen = vi.fn();
    useApp.setState({ setFigureBuilderOpen });
    await runExportFigure();
    await called;
    expect(setFigureBuilderOpen).not.toHaveBeenCalled();
  });

  it("Export figure… brings an already-open export view back instead of refusing silently", async () => {
    quick.run.mockReset();
    const setFigureBuilderOpen = vi.fn();
    const session = { target: "new-editable" as const, windowId: null, baseline: {} as never, draft: {} as never };
    useApp.setState({ datasets: [sampleDataset()], activeId: "d1", figurePublicationSession: session, setFigureBuilderOpen });
    await runExportFigure();
    expect(setFigureBuilderOpen).toHaveBeenCalledWith(true);
    expect(useApp.getState().figurePublicationSession).toBe(session);
    expect(quick.run).not.toHaveBeenCalled();
  });

  it("keeps the quick dialog reachable as its own command", async () => {
    const called = quickCalled();
    const command = withCommandDocs(buildFileCommands(useApp.getState)).find((item) => item.id === "export-figure-quick");
    expect(command?.label).toBe("Export figure (quick dialog)…");
    await runAndSettle(command);
    await called;
    expect(quick.run).toHaveBeenCalledTimes(1);
  });

  // The F0.1/F0.4 renames must not orphan the legacy names in the palette or
  // Help — both search label + keywords with the same in-order fuzzy matcher
  // (the #78–#81 keyword-migration regression class). A label rename with no
  // `keywords` carrying the old term returns ZERO results for it.
  it.each([
    ["figure-builder", "figure builder"],
    ["figure-page", "figure page"],
  ])("%s stays findable by its legacy name %j", (id, legacyQuery) => {
    const command = withCommandDocs(buildFileCommands(useApp.getState)).find((item) => item.id === id);
    expect(command).toBeDefined();
    // Same OR the palette applies: fuzzy label match, else fuzzy keywords match.
    const found =
      fuzzy(legacyQuery, command?.label ?? "") !== null ||
      fuzzy(legacyQuery, command?.keywords ?? "") !== null;
    expect(found).toBe(true);
  });
});
