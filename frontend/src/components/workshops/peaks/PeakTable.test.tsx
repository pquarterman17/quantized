// PeakTable — presentation + keyboard-nav coverage. Panel-level selection
// SEMANTICS (click/ctrl/shift, reset-on-result-change, cross-table
// governance) live in peakSelection.test.ts and PeaksPanel.test.tsx; this
// file covers what THIS component owns: roving tabindex (one tab stop per
// table, arrows move it — K2 review finding) and the interactive/inert
// presentation split a non-governing table needs (K1 review finding).

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import PeakTable from "./PeakTable";

const COLUMNS = ["#", "value"];
const ROWS = [
  [1, "a"],
  [2, "b"],
  [3, "c"],
];

describe("PeakTable — interactive (governing table)", () => {
  it("clicking a row reports the click's modifiers", () => {
    const onSelect = vi.fn();
    render(<PeakTable ariaLabel="test peaks" columns={COLUMNS} rows={ROWS} selected={new Set()} onSelect={onSelect} />);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    fireEvent.click(rows[1], { ctrlKey: true });
    expect(onSelect).toHaveBeenCalledWith(1, { shift: false, ctrlOrMeta: true });
  });

  it("Enter/Space on a row selects it", () => {
    const onSelect = vi.fn();
    render(<PeakTable ariaLabel="test peaks" columns={COLUMNS} rows={ROWS} selected={new Set()} onSelect={onSelect} />);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    fireEvent.keyDown(rows[0], { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(0, { shift: false, ctrlOrMeta: false });
  });

  it("selected rows carry aria-selected=true, others aria-selected=false", () => {
    render(<PeakTable ariaLabel="test peaks" columns={COLUMNS} rows={ROWS} selected={new Set([1])} onSelect={vi.fn()} />);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
  });
});

describe("PeakTable — K2 (red-first): roving tabindex, not one stop per row", () => {
  it("exactly ONE row is in the tab order at a time", () => {
    render(<PeakTable ariaLabel="test peaks" columns={COLUMNS} rows={ROWS} selected={new Set()} onSelect={vi.fn()} />);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    const tabbable = rows.filter((r) => r.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
  });

  it("ArrowDown moves the roving tab stop to the next row (focus, not selection)", () => {
    const onSelect = vi.fn();
    render(<PeakTable ariaLabel="test peaks" columns={COLUMNS} rows={ROWS} selected={new Set()} onSelect={onSelect} />);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    rows[0].focus();
    fireEvent.keyDown(rows[0], { key: "ArrowDown" });

    expect(document.activeElement).toBe(rows[1]);
    expect(rows[1].tabIndex).toBe(0);
    expect(rows[0].tabIndex).toBe(-1);
    expect(rows[2].tabIndex).toBe(-1);
    expect(onSelect).not.toHaveBeenCalled(); // plain arrow moves focus only
  });

  it("Shift+ArrowDown extends the selection while moving focus", () => {
    const onSelect = vi.fn();
    render(<PeakTable ariaLabel="test peaks" columns={COLUMNS} rows={ROWS} selected={new Set([0])} onSelect={onSelect} />);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    rows[0].focus();
    fireEvent.keyDown(rows[0], { key: "ArrowDown", shiftKey: true });

    expect(onSelect).toHaveBeenCalledWith(1, { shift: true, ctrlOrMeta: false });
    expect(document.activeElement).toBe(rows[1]);
  });
});

describe("PeakTable — K1 (red-first): a non-governing table (onSelect omitted) is fully inert", () => {
  it("rows carry no aria-selected, no highlight, and are not tab stops", () => {
    render(<PeakTable ariaLabel="test peaks" columns={COLUMNS} rows={ROWS} selected={new Set([1])} />);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    for (const r of rows) {
      expect(r).not.toHaveAttribute("aria-selected");
      expect(r.tabIndex).toBe(-1);
    }
  });

  it("a click on an inert row does nothing (no handler attached)", () => {
    render(<PeakTable ariaLabel="test peaks" columns={COLUMNS} rows={ROWS} selected={new Set()} />);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    // Must not throw, and must not mark the row selected.
    fireEvent.click(rows[0]);
    expect(rows[0]).not.toHaveAttribute("aria-selected");
  });
});
