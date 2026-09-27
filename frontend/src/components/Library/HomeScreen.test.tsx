// The empty-Library home screen (MAIN_PLAN #38). It COMPOSES the #31 recents /
// working-path stores and the #32 recovery health — so the tests care most
// about it staying non-destructive and never inventing a signal it cannot know.

import { act, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import HomeScreen, { stateBadge } from "./HomeScreen";
import { openRecentProject } from "../../commands/recentProjectsCommands";
import { useAutosaveStatus } from "../../store/autosaveStatus";
import { useApp } from "../../store/useApp";
import { useRecentProjects } from "../../store/recentProjects";
import { useWorkingPaths } from "../../store/workingPaths";

// Typed with the param it actually receives — `vi.fn(async () => …)` infers a
// zero-arg signature, which type-checks in the test run but fails the build.
const pathState = vi.fn(async (_path: string): Promise<string> => "ok");
vi.mock("../../lib/desktopBridge", () => ({ pathState: (p: string) => pathState(p) }));
vi.mock("../../commands/recentProjectsCommands", () => ({ openRecentProject: vi.fn() }));

const noop = () => {};

beforeEach(() => {
  vi.clearAllMocks();
  pathState.mockResolvedValue("ok");
  useApp.setState({
    recent: [], datasets: [], activeId: null, importWizardOpen: false,
    stageTab: "plot", groupKey: null,
  });
  useRecentProjects.setState({ recentProjects: [] });
  useWorkingPaths.setState({ paths: [], current: "" });
  useAutosaveStatus.setState({ health: { savedAt: null, error: null, count: 0 } });
});

describe("stateBadge", () => {
  it("shows nothing for a healthy or unknown source", () => {
    // A badge on every healthy row is noise, and "unknown" — no bridge to ask —
    // must not be dressed up as a problem.
    expect(stateBadge("ok")).toBeNull();
    expect(stateBadge("unknown")).toBeNull();
  });

  it("marks an unreadable (permission-denied) source as present, not missing (P1.1)", () => {
    expect(stateBadge("permission_denied")?.text).toBe("no access");
    expect(stateBadge("permission_denied")?.tone).not.toBe(stateBadge("missing")?.tone);
  });

  it("distinguishes offline from missing", () => {
    expect(stateBadge("offline")?.text).toBe("offline");
    expect(stateBadge("missing")?.text).toBe("missing");
    expect(stateBadge("offline")?.tone).not.toBe(stateBadge("missing")?.tone);
  });
});

describe("HomeScreen", () => {
  const recent = [{ name: "scan.dat", size: 1, at: new Date().toISOString(), path: "/d/scan.dat" }];

  it("always offers import", () => {
    render(<HomeScreen onImport={noop} />);
    expect(screen.getByRole("button", { name: /Import data/ })).toBeInTheDocument();
  });

  it("offers the guided import path without mutating the library", () => {
    render(<HomeScreen onImport={noop} />);
    screen.getByRole("button", { name: /Guided import/ }).click();
    expect(useApp.getState().importWizardOpen).toBe(true);
    expect(useApp.getState().datasets).toEqual([]);
  });

  it("reopens recent projects through the established safe reopen path", () => {
    useRecentProjects.setState({
      recentProjects: [{ name: "analysis.dwk", path: "/work/analysis.dwk", at: new Date().toISOString() }],
    });
    render(<HomeScreen onImport={noop} />);
    screen.getByRole("button", { name: /analysis\.dwk/ }).click();
    expect(openRecentProject).toHaveBeenCalledWith("analysis.dwk", "/work/analysis.dwk");
  });

  it.each([
    ["1-D", "example-1d-signal.csv", "plot", null],
    ["Grouped", "example-grouped-lots.csv", "plot", 1],
    ["2-D", "example-2d-map.csv", "map", null],
  ] as const)("loads the %s example into its useful first view", async (button, name, stageTab, groupKey) => {
    render(<HomeScreen onImport={noop} />);
    screen.getByRole("button", { name: button }).click();
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(1));
    const state = useApp.getState();
    expect(state.datasets[0].name).toBe(name);
    expect(state.stageTab).toBe(stageTab);
    expect(state.groupKey).toBe(groupKey);
  });

  it("a double-click loads ONE example, not two", async () => {
    // Both clicks are dispatched before React can re-render Home away (a
    // standalone render never unmounts at all), so only the handler's own
    // "Library already has data" check stands between them.
    render(<HomeScreen onImport={noop} />);
    const button = screen.getByRole("button", { name: "1-D" });
    button.click();
    button.click();
    await waitFor(() => expect(useApp.getState().datasets.length).toBeGreaterThan(0));
    await act(() => new Promise((r) => setTimeout(r, 20))); // let any second load land
    expect(useApp.getState().datasets).toHaveLength(1);
  });

  it("never lands an example on top of data already in the Library", async () => {
    const mine = { id: "ds-mine", name: "mine.csv", data: { time: [0, 1], values: [[1], [2]], labels: ["y"], units: [""], metadata: {} } };
    useApp.setState({ datasets: [mine], activeId: mine.id });
    render(<HomeScreen onImport={noop} />);
    screen.getByRole("button", { name: "Grouped" }).click();
    await act(() => new Promise((r) => setTimeout(r, 20)));
    const s = useApp.getState();
    expect(s.datasets.map((d) => d.id)).toEqual(["ds-mine"]);
    expect(s.activeId).toBe("ds-mine");
    expect(s.groupKey).toBeNull();
  });

  it("loading the grouped example is ONE undo step (grouping included)", async () => {
    useApp.setState({ history: [], future: [] });
    render(<HomeScreen onImport={noop} />);
    screen.getByRole("button", { name: "Grouped" }).click();
    await waitFor(() => expect(useApp.getState().groupKey).toBe(1));
    expect(useApp.getState().history).toHaveLength(1);
    act(() => useApp.getState().undo());
    expect(useApp.getState().datasets).toEqual([]);
    expect(useApp.getState().groupKey).toBeNull();
  });

  it("keeps the example's own notation in the status line", async () => {
    render(<HomeScreen onImport={noop} />);
    screen.getByRole("button", { name: "2-D" }).click();
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(1));
    expect(useApp.getState().status).toContain("2-D");
  });

  it("a double-click on a recent project starts ONE reopen", async () => {
    let finish: (v: "applied") => void = () => {};
    vi.mocked(openRecentProject).mockReturnValueOnce(new Promise((r) => (finish = r)));
    useRecentProjects.setState({
      recentProjects: [{ name: "analysis.dwk", path: "/work/analysis.dwk", at: new Date().toISOString() }],
    });
    render(<HomeScreen onImport={noop} />);
    const row = screen.getByRole("button", { name: /analysis\.dwk/ });
    row.click();
    row.click();
    expect(openRecentProject).toHaveBeenCalledTimes(1);
    await act(async () => finish("applied"));
    // Settled: a later, deliberate click reopens again (e.g. after a cancel).
    row.click();
    expect(openRecentProject).toHaveBeenCalledTimes(2);
  });

  it("labels the example buttons as one group for assistive tech", () => {
    render(<HomeScreen onImport={noop} />);
    const group = screen.getByRole("group", { name: "Try an example" });
    expect(within(group).getAllByRole("button")).toHaveLength(3);
  });

  it("lists recent files", () => {
    useApp.setState({ recent });
    render(<HomeScreen onImport={noop} />);
    expect(screen.getByText(/scan\.dat/)).toBeInTheDocument();
  });

  it("marks an OFFLINE source without offering to clean it up", () => {
    // Non-destructive by construction: an unmounted share is shown and nothing
    // more — no automatic relink, no "tidy your recents".
    pathState.mockResolvedValue("offline");
    useApp.setState({ recent });
    render(<HomeScreen onImport={noop} />);
    return waitFor(() => expect(screen.getByText("offline")).toBeInTheDocument());
  });

  it("does not probe a pathless entry", async () => {
    // A browser upload never had a path; claiming to know its state would be a
    // false signal.
    useApp.setState({ recent: [{ name: "up.csv", size: 1, at: new Date().toISOString() }] });
    render(<HomeScreen onImport={noop} />);
    await waitFor(() => expect(screen.getByText("up.csv")).toBeInTheDocument());
    expect(pathState).not.toHaveBeenCalled();
  });

  it("lists working paths and can pin one", () => {
    useWorkingPaths.setState({
      paths: [{ path: "/data/xrd", label: "xrd", pinned: false, usedAt: 1 }],
      current: "",
    });
    render(<HomeScreen onImport={noop} />);
    expect(screen.getByText("xrd")).toBeInTheDocument();
    screen.getByRole("button", { name: "Pin xrd" }).click();
    expect(useWorkingPaths.getState().paths[0].pinned).toBe(true);
  });

  it("reports autosave health, and shouts when it is failing", () => {
    useAutosaveStatus.setState({ health: { savedAt: 1, error: "quota", count: 2 } });
    render(<HomeScreen onImport={noop} />);
    expect(screen.getByRole("alert")).toHaveTextContent("autosave is failing");
  });

  it("says so plainly when nothing is autosaved yet", () => {
    render(<HomeScreen onImport={noop} />);
    expect(screen.getByText("Nothing autosaved yet")).toBeInTheDocument();
  });
});
