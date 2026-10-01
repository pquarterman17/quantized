// Preferences' section strip is a WAI-ARIA tablist (PRIMARY_SOFTWARE_AUDIT_PLAN,
// accessible names/state — batch 12 found it was clickable <div>s with no role
// and no keyboard path). Vertical, roving tabindex, AUTOMATIC activation: a
// pane is local state rendered synchronously, so selecting on focus costs
// nothing and saves the Enter press.

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import PreferencesDialog from "./PreferencesDialog";
import { useApp } from "../../store/useApp";

const SECTIONS = ["Appearance", "Plot", "Interaction", "Numbers", "Keyboard"];

afterEach(() => useApp.getState().setPrefsOpen(false));

function openPrefs() {
  useApp.getState().setPrefsOpen(true);
  render(<PreferencesDialog />);
  const list = screen.getByRole("tablist", { name: "Preferences sections" });
  return { list, tabs: within(list).getAllByRole("tab") };
}

const selected = (tabs: HTMLElement[]) => tabs.filter((t) => t.getAttribute("aria-selected") === "true");

describe("Preferences section tabs", () => {
  it("are a vertical tablist whose tabs control one pane labelled by the selected tab", () => {
    const { list, tabs } = openPrefs();
    expect(list).toHaveAttribute("aria-orientation", "vertical");
    expect(tabs.map((t) => t.textContent)).toEqual(SECTIONS);
    const panel = screen.getByRole("tabpanel", { name: "Appearance" });
    for (const t of tabs) expect(t).toHaveAttribute("aria-controls", panel.id);
    expect(selected(tabs)).toEqual([tabs[0]]);
    // Roving tabindex: the strip is ONE Tab stop, on the selected section.
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1, -1, -1]);
  });

  it("Down/Right select the next section and Up/Left the previous, wrapping; Home/End jump", () => {
    const { tabs } = openPrefs();
    tabs[0].focus();
    const press = (key: string, expected: string) => {
      fireEvent.keyDown(document.activeElement!, { key });
      const now = tabs[SECTIONS.indexOf(expected)];
      expect(now).toHaveFocus();
      expect(selected(tabs)).toEqual([now]);
      expect(now.tabIndex).toBe(0);
      expect(screen.getByRole("tabpanel", { name: expected })).toBeInTheDocument();
    };
    press("ArrowDown", "Plot");
    expect(screen.getByRole("combobox", { name: "Default trace" })).toBeInTheDocument();
    press("ArrowRight", "Interaction");
    press("ArrowUp", "Plot");
    press("ArrowLeft", "Appearance");
    press("ArrowUp", "Keyboard");
    press("ArrowDown", "Appearance");
    press("End", "Keyboard");
    press("Home", "Appearance");
  });

  it("a modified arrow is left alone", () => {
    const { tabs } = openPrefs();
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: "ArrowDown", altKey: true });
    expect(tabs[0]).toHaveFocus();
    expect(selected(tabs)).toEqual([tabs[0]]);
  });

  it("Tab leaves the strip for the pane instead of visiting each section", async () => {
    const user = userEvent.setup();
    const { tabs } = openPrefs();
    fireEvent.click(tabs[1]);
    tabs[1].focus();
    await user.tab();
    expect(tabs).not.toContain(document.activeElement);
    expect(screen.getByRole("tabpanel", { name: "Plot" })).toContainElement(document.activeElement as HTMLElement);
    await user.tab({ shift: true });
    expect(tabs[1]).toHaveFocus();
  });
});
