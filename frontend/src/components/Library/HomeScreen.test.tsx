// The empty-Library home screen (MAIN_PLAN #38). It COMPOSES the #31 recents /
// working-path stores and the #32 recovery health — so the tests care most
// about it staying non-destructive and never inventing a signal it cannot know.

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import HomeScreen, { stateBadge } from "./HomeScreen";
import { useAutosaveStatus } from "../../store/autosaveStatus";
import { useApp } from "../../store/useApp";
import { useWorkingPaths } from "../../store/workingPaths";

// Typed with the param it actually receives — `vi.fn(async () => …)` infers a
// zero-arg signature, which type-checks in the test run but fails the build.
const pathState = vi.fn(async (_path: string): Promise<string> => "ok");
vi.mock("../../lib/desktopBridge", () => ({ pathState: (p: string) => pathState(p) }));

const noop = () => {};

beforeEach(() => {
  vi.clearAllMocks();
  pathState.mockResolvedValue("ok");
  useApp.setState({ recent: [], datasets: [] });
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

  it("lists recent files", () => {
    useApp.setState({ recent });
    render(<HomeScreen onImport={noop} />);
    expect(screen.getByText("scan.dat")).toBeInTheDocument();
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
