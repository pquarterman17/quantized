// Preferences ▸ General / Fitting / Data & files rows (PREFS_AUDIT lane 4) and
// the first-run hints pref.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { fitPrefsSlot } from "../../lib/fitPrefs";
import { WORKFLOW_DEFAULTS, workflowPrefsSlot } from "../../lib/workflowPrefs";
import { setWorkflowPrefs } from "../../lib/workflowPrefsEdit";
import InteractionHints, { showInteractionHints } from "./InteractionHints";
import PrefsFilesPane from "./PrefsFilesPane";
import PrefsFittingPane from "./PrefsFittingPane";
import PrefsGeneralPane from "./PrefsGeneralPane";
import { PREFS_TABS } from "./prefsTabs";

beforeEach(() => localStorage.clear());

const type = (name: string, v: string) => fireEvent.change(screen.getByRole("textbox", { name }), { target: { value: v } });

describe("General pane", () => {
  it("shows today's defaults and both confirmations ON", () => {
    render(<PrefsGeneralPane />);
    expect(screen.getByRole("textbox", { name: "Undo steps" })).toHaveValue("50");
    expect(screen.getByRole("textbox", { name: "Autosave delay" })).toHaveValue("0.8");
    expect(screen.getByRole("switch", { name: "Warn before closing with unsaved changes" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Confirm before replacing the workspace" })).toHaveAttribute("aria-checked", "true");
  });

  it("saves an in-range value and refuses an out-of-range one with a reason", () => {
    render(<PrefsGeneralPane />);
    type("Undo steps", "120");
    expect(workflowPrefsSlot.load().undoDepth).toBe(120);
    type("Undo steps", "5");
    expect(workflowPrefsSlot.load().undoDepth).toBe(120);
    expect(screen.getByRole("alert")).toHaveTextContent("from 10 to 200");
    type("Autosave delay", "0.1");
    expect(workflowPrefsSlot.load().autosaveDebounceSec).toBe(0.8);
    type("Recovery copies kept", "2.5");
    expect(workflowPrefsSlot.load().autosaveGenerations).toBe(3);
  });

  it("each switch writes its pref", () => {
    render(<PrefsGeneralPane />);
    fireEvent.click(screen.getByRole("switch", { name: "Warn before closing with unsaved changes" }));
    fireEvent.click(screen.getByRole("switch", { name: "Confirm before replacing the workspace" }));
    fireEvent.click(screen.getByRole("switch", { name: "Show first-run hints" }));
    const p = workflowPrefsSlot.load();
    expect([p.confirmUnsavedClose, p.confirmReplaceWorkspace, p.showFirstRunHints]).toEqual([false, false, false]);
  });

  it("the General tab's Reset restores its fields only", () => {
    setWorkflowPrefs({ undoDepth: 99, rememberImportSettings: true });
    PREFS_TABS.find((t) => t.id === "General")?.reset?.extra?.();
    expect(workflowPrefsSlot.load().undoDepth).toBe(WORKFLOW_DEFAULTS.undoDepth);
    expect(workflowPrefsSlot.load().rememberImportSettings).toBe(true);
  });
});

describe("Fitting pane", () => {
  it("shows the unchanged solver defaults and writes valid values", () => {
    render(<PrefsFittingPane />);
    expect(screen.getByRole("textbox", { name: "Fit max iterations per parameter" })).toHaveValue("5000");
    expect(screen.getByRole("textbox", { name: "Fit function tolerance" })).toHaveValue("1e-12");
    type("Fit max iterations per parameter", "2000");
    type("Fit parameter tolerance", "1e-8");
    expect(fitPrefsSlot.load()).toMatchObject({ maxIterPerParam: 2000, tolX: 1e-8 });
  });

  it("refuses out-of-range solver values", () => {
    render(<PrefsFittingPane />);
    type("Fit max iterations per parameter", "50");
    type("Fit function tolerance", "0.5");
    expect(fitPrefsSlot.load()).toMatchObject({ maxIterPerParam: 5000, tolFun: 1e-12 });
  });
});

describe("Data & files: remember import settings", () => {
  it("toggles the opt-in and clears the memory when turned off", () => {
    render(<PrefsFilesPane />);
    const sw = screen.getByRole("switch", { name: "Remember import settings" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);
    setWorkflowPrefs({ importMemory: { delimiter: "tab", header_line: 1, units_line: null } });
    fireEvent.click(screen.getByRole("switch", { name: "Remember import settings" }));
    expect(workflowPrefsSlot.load()).toMatchObject({ rememberImportSettings: false, importMemory: null });
  });
});

describe("first-run hints", () => {
  it("shows the card on first run, not when the pref is off, and Help still opens it", async () => {
    setWorkflowPrefs({ showFirstRunHints: false });
    const { unmount } = render(<InteractionHints />);
    expect(screen.queryByLabelText("Interaction hints")).toBeNull();
    act(() => showInteractionHints());
    expect(await screen.findByLabelText("Interaction hints")).toBeInTheDocument();
    unmount();
    localStorage.clear();
    render(<InteractionHints />);
    expect(await screen.findByLabelText("Interaction hints")).toBeInTheDocument();
  });
});
