// A tool window opened UNDER an open modal (from the store, as a background
// operation would) must never take focus from it -- docked or not. A docked
// window's claim re-renders synchronously, which can flush the window's "take
// focus on mount" effect before the inert walk has marked it; WebKit and
// Firefox then moved focus out of Preferences (modal-inert.spec.ts, CI on PR
// #723). jsdom implements no `inert`, so without the gate focus() lands in the
// frame here in BOTH cases (checked by removing it): this pins the gate itself,
// not the browser race, which the e2e spec covers.

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import PreferencesDialog from "./PreferencesDialog";
import ToolWindow from "./ToolWindow";
import { TOOL_DOCK_KEY, resetToolDockForTests, toolDockSnapshot } from "../../store/toolDock";
import { useApp } from "../../store/useApp";

function Shell({ dockable, shown = false }: { dockable: boolean; shown?: boolean }) {
  return (
    <div className="qzk-app">
      <div className="qzk-main">
        <button type="button">background control</button>
      </div>
      <PreferencesDialog />
      {shown && (
        <ToolWindow id="cf" title="Curve Fit" width={340} dockable={dockable} onClose={() => {}}>
          <button type="button">Run</button>
        </ToolWindow>
      )}
    </div>
  );
}

beforeEach(() => {
  // Owner decision 2026-11-25: a dock under 340 px floats. These tests are about docking itself, so
  // they run at the 1280 px desktop width where the column is wide enough.
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
  localStorage.removeItem(TOOL_DOCK_KEY);
  resetToolDockForTests();
  useApp.setState({ toolWindowLayout: {} });
  useApp.getState().setPrefsOpen(false);
});
afterEach(() => {
  useApp.getState().setPrefsOpen(false);
  resetToolDockForTests();
});

describe("a tool window opened under a modal", () => {
  for (const dockable of [true, false]) {
    it(`leaves focus in the dialog (${dockable ? "docked" : "floating"})`, async () => {
      const { rerender } = render(<Shell dockable={dockable} />);
      act(() => useApp.getState().setPrefsOpen(true));
      const prefs = await screen.findByRole("dialog", { name: "Preferences" });
      const button = prefs.querySelector<HTMLElement>("button")!;
      act(() => button.focus());
      expect(document.activeElement).toBe(button);

      rerender(<Shell dockable={dockable} shown />);

      expect(document.querySelector("[data-tool-window='cf']")).not.toBeNull();
      if (dockable) expect(toolDockSnapshot().owner).toBe("cf");
      expect(document.activeElement).toBe(button);
    });
  }

  it("still takes focus on open when no modal is open", () => {
    const { rerender } = render(<Shell dockable />);
    rerender(<Shell dockable shown />);
    expect(document.activeElement).toBe(document.querySelector("[data-tool-window='cf']"));
  });
});
