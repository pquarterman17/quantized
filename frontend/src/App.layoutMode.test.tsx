// App's one window-layout mount (WORKSPACE_LAYOUT_PLAN P1): classic mode
// renders the classic Stage + Inspector and never asks for the layout host's
// chunk; windows mode swaps both for the host and drops the Inspector column.
// The shell's heavy children are stubbed: this pins App's branch, not them.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApp } from "./store/useApp";
import App from "./App";

const { loaded } = vi.hoisted(() => ({ loaded: new Set<string>() }));

vi.mock("./components/workshops/windowlayout/LayoutHost", () => {
  loaded.add("LayoutHost");
  return { default: () => <section data-testid="layout-host" /> };
});
vi.mock("./components/Stage/Stage", () => ({ default: () => <section data-testid="classic-stage" /> }));
vi.mock("./components/Inspector/Inspector", () => ({ default: () => <aside data-testid="classic-inspector" /> }));
vi.mock("./components/Library/Library", () => ({ default: () => <aside className="qzk-library" /> }));
vi.mock("./components/Shell/MenuBar", () => ({ default: () => null }));
vi.mock("./components/Shell/TitleBar", () => ({ default: () => null }));
vi.mock("./components/Shell/StatusBar", () => ({ default: () => null }));
vi.mock("./components/overlays/CommandPaletteGate", () => ({ default: () => null }));
vi.mock("./AppOverlays", () => ({ default: () => null }));
vi.mock("./components/Shell/WindowFileDrop", () => ({ default: () => null }));
vi.mock("./useWorkspaceAutosave", () => ({
  useWorkspaceAutosave: () => {},
  engageBrowserAutosaveLock: () => Promise.resolve(),
  installBrowserAutosaveReengage: () => () => {},
}));
vi.mock("./useProjectLockHeartbeat", () => ({ useProjectLockHeartbeat: () => {} }));
vi.mock("./lib/api", async (importOriginal) => ({ ...(await importOriginal<object>()), health: () => new Promise(() => {}) }));

beforeEach(() => {
  loaded.clear();
  useApp.setState({ quickFigureBuilderDatasetId: null, leftCollapsed: false });
});

describe("App and layoutMode", () => {
  it("classic renders the classic stage and Inspector, and never loads the layout host", async () => {
    useApp.setState({ layoutMode: "classic" });
    const { container } = render(<App />);
    expect(await screen.findByTestId("classic-inspector")).toBeInTheDocument();
    expect(screen.getByTestId("classic-stage")).toBeInTheDocument();
    expect(screen.queryByTestId("layout-host")).toBeNull();
    expect(container.querySelector(".qzk-main")?.className).toBe("qzk-main");
    expect(loaded.has("LayoutHost")).toBe(false);
  });

  it("windows mode mounts the lazy host in place of the stage and Inspector", async () => {
    useApp.setState({ layoutMode: "windows" });
    const { container } = render(<App />);
    expect(await screen.findByTestId("layout-host")).toBeInTheDocument();
    expect(loaded.has("LayoutHost")).toBe(true);
    expect(screen.queryByTestId("classic-stage")).toBeNull();
    expect(screen.queryByTestId("classic-inspector")).toBeNull();
    expect(container.querySelector(".qzk-main")?.className).toBe("qzk-main wl");
  });

  it("switching back to classic restores the classic stage", async () => {
    useApp.setState({ layoutMode: "windows" });
    render(<App />);
    expect(await screen.findByTestId("layout-host")).toBeInTheDocument();
    useApp.setState({ layoutMode: "classic" });
    await waitFor(() => expect(screen.queryByTestId("layout-host")).toBeNull());
    expect(await screen.findByTestId("classic-stage")).toBeInTheDocument();
  });

  it("a collapsed Library leaves a labelled Library button that expands it (classic and windows mode)", async () => {
    for (const mode of ["classic", "windows"] as const) {
      useApp.setState({ layoutMode: mode, leftCollapsed: true });
      const { unmount } = render(<App />);
      fireEvent.click(await screen.findByRole("button", { name: /Library/ }));
      expect(useApp.getState().leftCollapsed).toBe(false);
      expect(screen.queryByRole("button", { name: /Library/ })).toBeNull();
      unmount();
    }
  });
});
