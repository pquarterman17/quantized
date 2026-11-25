// PREFS_AUDIT lane 1 in the dialog: Reset tab / Reset all (behind a confirm),
// search, last-tab memory, and the tab registry's keyword contract.

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./ConfirmDialog", () => ({ askConfirm: vi.fn(async () => true) }));

import { askConfirm } from "./ConfirmDialog";
import PreferencesDialog, { PREFS_DIALOG_KEY } from "./PreferencesDialog";
import { PREFS_TABS, normQuery, tabMatches } from "./prefsTabs";
import { bootstrapCap, saveBootstrapCap } from "../../lib/fitPrefs";
import { PREF_DEFAULTS, loadInteractionPrefs, loadPlotPerfPrefs, saveInteractionPrefs, savePlotPerfPrefs } from "../../store/prefs";
import { useApp } from "../../store/useApp";

const open = () => {
  useApp.getState().setPrefsOpen(true);
  return render(<PreferencesDialog />);
};
const tabNames = () => within(screen.getByRole("tablist")).queryAllByRole("tab").map((t) => t.textContent);
const flush = () => act(async () => await Promise.resolve());

beforeEach(() => {
  localStorage.removeItem(PREFS_DIALOG_KEY);
  vi.mocked(askConfirm).mockClear();
  vi.mocked(askConfirm).mockResolvedValue(true);
});
afterEach(() => {
  useApp.getState().setPrefsOpen(false);
  const st = useApp.getState();
  st.setPref("themeMode", "dark");
  st.setPref("accent", "violet");
  st.setPref("sigFigs", 6);
  st.setPref("notation", "auto");
  st.setPref("defaultTrace", "Line");
  saveInteractionPrefs({ persistentTool: false });
  savePlotPerfPrefs({ decimateDensePlots: true });
});

describe("Reset", () => {
  it("Reset tab restores only that tab's prefs, after a confirm", async () => {
    const st = useApp.getState();
    st.setPref("sigFigs", 3);
    st.setPref("notation", "scientific");
    st.setPref("accent", "rose"); // another tab: must survive
    open();
    fireEvent.click(screen.getByRole("tab", { name: "Numbers" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset tab…" }));
    await flush();
    expect(askConfirm).toHaveBeenCalledWith("Reset Numbers preferences?", expect.any(String), "Reset tab", true);
    expect(useApp.getState().sigFigs).toBe(PREF_DEFAULTS.sigFigs);
    expect(useApp.getState().notation).toBe("auto");
    expect(useApp.getState().accent).toBe("rose");
    expect(screen.getByRole("slider", { name: "Significant figures" })).toHaveValue(String(PREF_DEFAULTS.sigFigs));
  });

  it("a declined confirm changes nothing", async () => {
    vi.mocked(askConfirm).mockResolvedValue(false);
    useApp.getState().setPref("sigFigs", 3);
    open();
    fireEvent.click(screen.getByRole("tab", { name: "Numbers" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset tab…" }));
    await flush();
    expect(useApp.getState().sigFigs).toBe(3);
  });

  it("Reset tab covers the tab's side slots, and the pane shows them at once", async () => {
    saveInteractionPrefs({ persistentTool: true });
    open();
    fireEvent.click(screen.getByRole("tab", { name: "Interaction" }));
    expect(screen.getByRole("switch", { name: "Persistent tool" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Reset tab…" }));
    await flush();
    expect(loadInteractionPrefs().persistentTool).toBe(false);
    expect(screen.getByRole("switch", { name: "Persistent tool" })).not.toBeChecked();
  });

  it("Fitting's Reset tab puts the bootstrap cap back to 10,000 and the field follows", async () => {
    saveBootstrapCap(500);
    open();
    fireEvent.click(screen.getByRole("tab", { name: "Fitting" }));
    expect(screen.getByRole("textbox", { name: "Maximum bootstrap replicates" })).toHaveValue("500");
    fireEvent.click(screen.getByRole("button", { name: "Reset tab…" }));
    await flush();
    expect(bootstrapCap()).toBe(10_000);
    expect(screen.getByRole("textbox", { name: "Maximum bootstrap replicates" })).toHaveValue("10000");
  });

  it("Reset all restores every tab's prefs and slots, but never content slots", async () => {
    const st = useApp.getState();
    st.setPref("accent", "rose");
    st.setPref("sigFigs", 3);
    st.setPref("defaultTrace", "Scatter");
    saveInteractionPrefs({ persistentTool: true });
    savePlotPerfPrefs({ decimateDensePlots: false });
    saveBootstrapCap(500);
    localStorage.setItem("qz.plotRecipes", '[{"name":"mine"}]');
    open();
    fireEvent.click(screen.getByRole("button", { name: "Reset all…" }));
    await flush();
    expect(askConfirm).toHaveBeenCalledWith("Reset all preferences?", expect.any(String), "Reset all", true);
    const now = useApp.getState();
    expect([now.accent, now.sigFigs, now.defaultTrace]).toEqual(["violet", 6, "Line"]);
    expect(now.themeMode).toBe("system");
    expect(loadInteractionPrefs().persistentTool).toBe(false);
    expect(loadPlotPerfPrefs().decimateDensePlots).toBe(true);
    expect(bootstrapCap()).toBe(10_000);
    expect(localStorage.getItem("qz.plotRecipes")).toBe('[{"name":"mine"}]');
    localStorage.removeItem("qz.plotRecipes");
  });

  it("Keyboard has nothing to reset: its Reset tab is disabled", () => {
    open();
    fireEvent.click(screen.getByRole("tab", { name: "Keyboard" }));
    expect(screen.getByRole("button", { name: "Reset tab…" })).toBeDisabled();
  });
});

describe("Search", () => {
  it("narrows the tabs, opens the first match and hides non-matching rows", () => {
    open();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search preferences" }), { target: { value: "notation" } });
    expect(tabNames()).toEqual(["Numbers"]);
    expect(screen.getByRole("tabpanel", { name: "Numbers" })).toBeInTheDocument();
    const rows = [...document.querySelectorAll<HTMLElement>(".qzk-pref-row")];
    const shown = rows.filter((r) => !r.hidden).map((r) => r.querySelector(".qzk-pref-lbl")!.textContent);
    expect(shown).toEqual(["Notation"]);
  });

  it("matches hints too, and a tab named by the query shows whole", () => {
    open();
    const box = screen.getByRole("searchbox", { name: "Search preferences" });
    fireEvent.change(box, { target: { value: "plot" } });
    expect(tabNames()).toContain("Plot");
    fireEvent.click(screen.getByRole("tab", { name: "Plot" }));
    expect([...document.querySelectorAll<HTMLElement>(".qzk-pref-row")].every((r) => !r.hidden)).toBe(true);
  });

  it("says so when nothing matches, and clearing restores every tab", () => {
    open();
    const box = screen.getByRole("searchbox", { name: "Search preferences" });
    fireEvent.change(box, { target: { value: "zzzz-nothing" } });
    expect(tabNames()).toEqual([]);
    expect(screen.getByText(/No preferences match/)).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "" } });
    expect(tabNames()).toEqual(PREFS_TABS.map((t) => t.id));
  });
});

describe("Last tab", () => {
  it("reopens on the tab it was left on", () => {
    const { unmount } = open();
    fireEvent.click(screen.getByRole("tab", { name: "Numbers" }));
    act(() => useApp.getState().setPrefsOpen(false));
    unmount();
    open();
    expect(screen.getByRole("tab", { name: "Numbers" })).toHaveAttribute("aria-selected", "true");
  });

  it("an unknown remembered tab falls back to the first", () => {
    localStorage.setItem(PREFS_DIALOG_KEY, JSON.stringify({ tab: "Gone" }));
    open();
    expect(screen.getByRole("tab", { name: "Appearance" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("tab registry", () => {
  it("every rendered row label is a keyword of its tab, so search can find the tab", () => {
    for (const def of PREFS_TABS) {
      const { container, unmount } = render(<def.Pane />);
      const labels = [...container.querySelectorAll(".qzk-pref-lbl")].map(
        (el) => (el.firstChild?.textContent ?? "").trim(),
      );
      for (const label of labels) expect(tabMatches(def, normQuery(label)), `${def.id}: "${label}"`).toBe(true);
      unmount();
    }
  });

  it("each reset spec only names real prefs (no typo silently resets nothing)", () => {
    for (const def of PREFS_TABS) for (const k of def.reset?.prefs ?? []) expect(k in PREF_DEFAULTS, `${def.id}: ${k}`).toBe(true);
  });
});
