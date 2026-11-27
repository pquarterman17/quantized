// OG18: the "Toolbar button labels" preference: its row, its search keywords,
// the round-trip through the local prefs slot, and Reset.

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadToolbarPrefs, toolbarPrefsSlot } from "../../store/prefs";
import { useApp } from "../../store/useApp";
import PreferencesDialog, { PREFS_DIALOG_KEY } from "./PreferencesDialog";
import { PREFS_TABS } from "./prefsTabs";

beforeEach(() => {
  localStorage.removeItem(PREFS_DIALOG_KEY);
  toolbarPrefsSlot.reset();
});
afterEach(() => {
  useApp.getState().setPrefsOpen(false);
  toolbarPrefsSlot.reset();
});

describe("Toolbar button labels preference", () => {
  it("is off by default and round-trips through the toolbar prefs slot, keeping the captions flag", () => {
    expect(loadToolbarPrefs().showButtonLabels).toBe(false);
    useApp.getState().setPrefsOpen(true);
    render(<PreferencesDialog />);
    fireEvent.click(screen.getByRole("tab", { name: "Plot" }));
    const sw = screen.getByRole("switch", { name: "Toolbar button labels" });
    expect(sw).not.toBeChecked();
    fireEvent.click(sw);
    expect(loadToolbarPrefs()).toEqual({ showGroupLabels: true, showButtonLabels: true });
    expect(JSON.parse(localStorage.getItem("qz.toolbarPrefs") ?? "{}").showButtonLabels).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: "Toolbar group labels" }));
    expect(loadToolbarPrefs()).toEqual({ showGroupLabels: false, showButtonLabels: true });
  });

  it("an old stored blob without the field reads as off", () => {
    localStorage.setItem("qz.toolbarPrefs", JSON.stringify({ showGroupLabels: false }));
    expect(loadToolbarPrefs()).toEqual({ showGroupLabels: false, showButtonLabels: false });
  });

  it("is findable by its label and by descriptive words", () => {
    const tab = PREFS_TABS.find((t) => t.id === "Plot");
    expect(tab?.keywords).toContain("Toolbar button labels");
    const words = tab?.keywords.join(" ").toLowerCase() ?? "";
    for (const w of ["toolbar", "labels", "text", "names", "icons", "buttons", "captions"]) expect(words).toContain(w);
  });

  it("the search box finds the Plot tab for 'icons'", () => {
    useApp.getState().setPrefsOpen(true);
    render(<PreferencesDialog />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search preferences" }), { target: { value: "icons" } });
    expect(screen.getByRole("switch", { name: "Toolbar button labels" })).toBeInTheDocument();
  });
});
