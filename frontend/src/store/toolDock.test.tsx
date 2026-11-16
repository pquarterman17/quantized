// UX-F: analysis tool windows dock INTO the side column (replacing the
// Inspector) instead of floating over it. The claim registry, the persisted
// float choice, and ToolWindow's dock / float affordances.

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import ToolWindow from "../components/overlays/ToolWindow";
import {
  TOOL_DOCK_KEY,
  dockColumnWidth,
  dockToolWindow,
  registerDockable,
  resetToolDockForTests,
  toolDockSnapshot,
  undockToolWindow,
} from "./toolDock";
import { useApp } from "./useApp";

beforeEach(() => {
  localStorage.removeItem(TOOL_DOCK_KEY);
  resetToolDockForTests();
  useApp.setState({ toolWindowLayout: {} });
});
afterEach(() => {
  localStorage.removeItem(TOOL_DOCK_KEY);
  resetToolDockForTests();
});

describe("tool dock registry", () => {
  it("the most recent claimant owns the column; it passes back on unmount", () => {
    const a = registerDockable("a", 340);
    expect(toolDockSnapshot()).toEqual({ owner: "a", width: 340 });
    const b = registerDockable("b", 420);
    expect(toolDockSnapshot()).toEqual({ owner: "b", width: 420 });
    b();
    expect(toolDockSnapshot()).toEqual({ owner: "a", width: 340 });
    a();
    expect(toolDockSnapshot()).toEqual({ owner: null, width: 0 });
  });

  it("a floated window stays floated across sessions until docked again", () => {
    const off = registerDockable("a", 340);
    undockToolWindow("a");
    expect(toolDockSnapshot().owner).toBeNull();
    expect(JSON.parse(localStorage.getItem(TOOL_DOCK_KEY)!)).toEqual({ floating: ["a"] });
    off();
    // A new session: the stored choice is read back, so it opens floating.
    resetToolDockForTests();
    const again = registerDockable("a", 340);
    expect(toolDockSnapshot().owner).toBeNull();
    dockToolWindow("a");
    expect(toolDockSnapshot().owner).toBe("a");
    expect(JSON.parse(localStorage.getItem(TOOL_DOCK_KEY)!)).toEqual({ floating: [] });
    again();
  });

  it("an unreadable stored choice is ignored, not fatal", () => {
    localStorage.setItem(TOOL_DOCK_KEY, "{not json");
    resetToolDockForTests();
    const off = registerDockable("a", 340);
    expect(toolDockSnapshot().owner).toBe("a");
    off();
  });

  it("the column never squeezes the stage below 640 px beside the Library", () => {
    expect(dockColumnWidth(340)).toBe("min(340px, max(280px, calc(100vw - var(--lw, 210px) - 640px)))");
  });
});

describe("ToolWindow docking", () => {
  const renderDockable = () =>
    render(
      <ToolWindow id="cf" title="Curve Fit" width={340} dockable onClose={() => {}}>
        <button type="button">Run</button>
      </ToolWindow>,
    );
  const frame = () => document.querySelector<HTMLElement>("[data-tool-window='cf']")!;

  it("opens docked: no collapse or resize grip, a Float button", () => {
    renderDockable();
    expect(frame()).toHaveAttribute("data-docked");
    expect(screen.queryByRole("button", { name: "Collapse" })).toBeNull();
    expect(document.querySelector(".qzk-win-resize")).toBeNull();
    expect(screen.getByRole("button", { name: "Float Curve Fit" })).toBeInTheDocument();
  });

  it("Float undocks to a movable window; Dock puts it back", async () => {
    const user = userEvent.setup();
    renderDockable();
    await user.click(screen.getByRole("button", { name: "Float Curve Fit" }));
    expect(frame()).not.toHaveAttribute("data-docked");
    expect(toolDockSnapshot().owner).toBeNull();
    expect(useApp.getState().toolWindowLayout.cf).toMatchObject({ width: 340, collapsed: false });
    expect(screen.getByRole("button", { name: "Collapse" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Dock Curve Fit in the side panel" }));
    expect(frame()).toHaveAttribute("data-docked");
  });

  it("the arrow keys do not move a docked window", async () => {
    const user = userEvent.setup();
    renderDockable();
    screen.getByRole("group", { name: "Curve Fit title bar" }).focus();
    await user.keyboard("{ArrowRight}{ArrowDown}");
    expect(useApp.getState().toolWindowLayout.cf).toBeUndefined();
  });

  it("closing a docked window hands the column back to the Inspector", () => {
    const { unmount } = renderDockable();
    expect(toolDockSnapshot().owner).toBe("cf");
    act(() => unmount());
    expect(toolDockSnapshot().owner).toBeNull();
  });

  it("a window without `dockable` never docks", () => {
    render(
      <ToolWindow id="plain" title="Find peaks" onClose={() => {}}>
        <span />
      </ToolWindow>,
    );
    expect(toolDockSnapshot().owner).toBeNull();
    expect(screen.queryByRole("button", { name: /Dock|Float/ })).toBeNull();
  });
});
