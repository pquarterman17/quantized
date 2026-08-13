import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildFileCommands } from "./fileCommands";
import { fuzzy } from "../lib/fuzzy";
import { defaultPlotView } from "../lib/plotview";
import { useApp } from "../store/useApp";

// F2.1e fixture: minimal dataset shared by the no-focused-window canonical
// tests below -- shape mirrors figureLifecycle.test.ts's own fixture.
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

  it("opens a canonical detached session from the active dataset when no window is focused", () => {
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
    const command = buildFileCommands(useApp.getState).find((item) => item.id === "figure-builder");

    expect(command).toMatchObject({
      label: "Publication preview…",
      description: expect.stringContaining("Apply updates that figure"),
    });

    command?.run();
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

  it("falls back to the legacy no-Apply preview when neither a window nor a dataset is available", () => {
    const setFigureBuilderOpen = vi.fn();
    const beginFigurePublicationEdit = vi.fn().mockReturnValue(false);
    const setStatus = vi.fn();
    useApp.setState({ setFigureBuilderOpen, beginFigurePublicationEdit, setStatus });
    const command = buildFileCommands(useApp.getState).find((item) => item.id === "figure-builder");

    command?.run();
    expect(beginFigurePublicationEdit).toHaveBeenCalled();
    expect(setStatus).toHaveBeenCalledWith(
      "no plot window is focused — previewing the active dataset; Apply is unavailable in this mode",
    );
    expect(setFigureBuilderOpen).toHaveBeenCalledWith(true);
    expect(useApp.getState().figurePublicationSession).toBeNull();
  });

  it("round-trips: Apply from the unfocused-window entry point creates exactly one new editable figure", () => {
    const beginFigurePublicationEdit = vi.fn().mockReturnValue(false);
    useApp.setState({ datasets: [sampleDataset()], activeId: "d1", beginFigurePublicationEdit });
    const historyLength = useApp.getState().history.length;

    buildFileCommands(useApp.getState).find((item) => item.id === "figure-builder")?.run();
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

  it("begins a canonical focused-window session before falling back", () => {
    const setFigureBuilderOpen = vi.fn();
    const beginFigurePublicationEdit = vi.fn().mockReturnValue(true);
    useApp.setState({ setFigureBuilderOpen, beginFigurePublicationEdit });
    buildFileCommands(useApp.getState).find((item) => item.id === "figure-builder")?.run();
    expect(beginFigurePublicationEdit).toHaveBeenCalled();
    expect(setFigureBuilderOpen).not.toHaveBeenCalled();
  });

  it("preserves an active Publication Preview instead of invoking the legacy fallback", () => {
    const setFigureBuilderOpen = vi.fn();
    const beginFigurePublicationEdit = vi.fn().mockReturnValue(false);
    const setStatus = vi.fn();
    const session = { target: "new-editable" as const, windowId: null, baseline: {} as never, draft: {} as never };
    useApp.setState({ figurePublicationSession: session, setFigureBuilderOpen, beginFigurePublicationEdit, setStatus });

    buildFileCommands(useApp.getState).find((item) => item.id === "figure-builder")?.run();

    expect(beginFigurePublicationEdit).not.toHaveBeenCalled();
    expect(setFigureBuilderOpen).not.toHaveBeenCalled();
    expect(useApp.getState().figurePublicationSession).toBe(session);
    expect(setStatus).toHaveBeenCalledWith("finish or cancel the current Publication Preview before opening another");
  });

  it("identifies the multi-panel surface as a temporary export composition", () => {
    const setFigurePageOpen = vi.fn();
    useApp.setState({ setFigurePageOpen });
    const command = buildFileCommands(useApp.getState).find((item) => item.id === "figure-page");

    expect(command).toMatchObject({
      label: "Multi-panel export…",
      description: expect.stringContaining("Temporarily compose"),
    });

    command?.run();
    expect(setFigurePageOpen).toHaveBeenCalledWith(true);
  });

  // The F0.1/F0.4 renames must not orphan the legacy names in the palette or
  // Help — both search label + keywords with the same in-order fuzzy matcher
  // (the #78–#81 keyword-migration regression class). A label rename with no
  // `keywords` carrying the old term returns ZERO results for it.
  it.each([
    ["figure-builder", "figure builder"],
    ["figure-page", "figure page"],
  ])("%s stays findable by its legacy name %j", (id, legacyQuery) => {
    const command = buildFileCommands(useApp.getState).find((item) => item.id === id);
    expect(command).toBeDefined();
    // Same OR the palette applies: fuzzy label match, else fuzzy keywords match.
    const found =
      fuzzy(legacyQuery, command?.label ?? "") !== null ||
      fuzzy(legacyQuery, command?.keywords ?? "") !== null;
    expect(found).toBe(true);
  });
});
