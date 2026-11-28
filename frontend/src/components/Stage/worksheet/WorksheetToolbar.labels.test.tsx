// OG18 on the Data (worksheet) window toolbar. Every action there already carries its own word ("Σ Stats",
// "⧉ Copy", "Cut", "Plot selection"), so there is no icon-only button to caption: turning "Toolbar button
// labels" on must leave the bar, its accessible names and its overflow measure exactly as they are, and
// never add a second caption beside a word.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toolbarPrefsSlot } from "../../../store/prefs";
import { useApp } from "../../../store/useApp";
import PreferencesDialog, { PREFS_DIALOG_KEY } from "../../overlays/PreferencesDialog";
import WorksheetToolbar, { type WorksheetToolbarProps } from "./WorksheetToolbar";

const fn = () => vi.fn();
const props = (): WorksheetToolbarProps =>
  ({
    formula: "", colName: "", setFormula: fn(), setColName: fn(), onAddColumn: fn(), addColumnPending: false,
    showStats: false, onToggleStats: fn(), onCopy: fn(), onExport: fn(),
    blockOps: { hasBlock: true, hasRows: true, copyBlock: fn(), cutBlock: fn(), pasteBlock: fn(), clearBlock: fn(), fillDown: fn(), insertRows: fn(), deleteRows: fn() },
    maskedCount: 0, onUnmaskAll: fn(), selectedCount: 0, onExcludeSelected: fn(), onKeepOnlySelected: fn(), onClearSelection: fn(),
    onExtractSelected: fn(), onExtractAsk: fn(), rowRangeReason: null, onUseAsRowRange: fn(), vars: "", selectedColCount: 0, onPlotSelection: fn(),
    onAddSelectionToPlot: fn(), onOpenInGraphBuilder: fn(), onAnalyzeSelection: fn(), onClearColSelection: fn(), plotLinked: false,
  }) as WorksheetToolbarProps;

const ORIGINAL = useApp.getState();
beforeEach(() => {
  localStorage.removeItem(PREFS_DIALOG_KEY);
  toolbarPrefsSlot.reset();
});
afterEach(() => {
  useApp.getState().setPrefsOpen(false);
  useApp.setState(ORIGINAL, true);
  toolbarPrefsSlot.reset();
});

describe("Worksheet toolbar and the button-labels preference", () => {
  it("is the same DOM with the preference on as with it off", () => {
    const { container } = render(<WorksheetToolbar {...props()} />);
    const before = container.innerHTML;
    act(() => useApp.getState().setPrefsOpen(true));
    render(<PreferencesDialog />);
    fireEvent.click(screen.getByRole("tab", { name: "Plot" }));
    fireEvent.click(screen.getByRole("switch", { name: "Toolbar button labels" }));
    expect(toolbarPrefsSlot.load().showButtonLabels).toBe(true);
    expect(container.innerHTML).toBe(before);
    expect(container.querySelector("[data-label], .qzk-tool-label")).toBeNull();
    expect(screen.getByRole("button", { name: /Σ Stats/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /⧉ Copy/ })).toBeInTheDocument();
  });
});
