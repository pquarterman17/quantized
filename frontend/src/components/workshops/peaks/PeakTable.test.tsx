// PeakTable — presentation + keyboard-nav coverage. Panel-level selection
// SEMANTICS (click/ctrl/shift, reset-on-result-change, cross-table
// governance) live in peakSelection.test.ts and PeaksPanel.test.tsx; this
// file covers what THIS component owns: roving tabindex (one tab stop per
// table, arrows move it — K2 review finding) and the interactive/inert
// presentation split a non-governing table needs (K1 review finding).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import PeakTable from "./PeakTable";
import { usePeakTableSelection } from "./peakSelection";

const COLUMNS = ["#", "value"];
const ROWS = [
  [1, "a"],
  [2, "b"],
  [3, "c"],
];

// A STABLE module-level reference (peakSelection.ts's own RULING 2 contract:
// a fresh array literal every render would spuriously reset the selection).
const REAL_SOURCE: unknown[] = [{}, {}, {}];

/** Wires PeakTable to the REAL hook (not a mocked `onSelect`) — required to
 *  demonstrate range EXTENSION across multiple key presses at all: a mock
 *  never updates `selected`, so a second press has nothing to extend from
 *  and a bug that only breaks the SECOND press onward is invisible to it
 *  (N1 review finding — this is exactly what let the anchor bug ship). */
function StatefulPeakTable() {
  const selection = usePeakTableSelection(REAL_SOURCE);
  return (
    <PeakTable
      ariaLabel="test peaks"
      columns={COLUMNS}
      rows={ROWS}
      selected={selection.selected}
      onSelect={selection.select}
    />
  );
}

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

  it("Shift+ArrowDown calls onSelect with the extended target on a single press", () => {
    const onSelect = vi.fn();
    render(<PeakTable ariaLabel="test peaks" columns={COLUMNS} rows={ROWS} selected={new Set([0])} onSelect={onSelect} />);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    rows[0].focus();
    fireEvent.keyDown(rows[0], { key: "ArrowDown", shiftKey: true });

    // anchorHint: 0 (N1 fix) — the row this press started FROM, so a
    // keyboard-only sequence with no prior click has something to seed its
    // anchor from; see the real-state extension test below for why.
    expect(onSelect).toHaveBeenCalledWith(1, { shift: true, ctrlOrMeta: false, anchorHint: 0 });
    expect(document.activeElement).toBe(rows[1]);
  });

  // N1 (red-first): the single-press test above uses a MOCKED onSelect that
  // never updates `selected` — a mock can't demonstrate range EXTENSION at
  // all, since a second press has nothing real to extend from. This test
  // drives the REAL hook across two consecutive presses, which is what
  // caught the actual bug: `select`'s shift branch never wrote `anchorRef`,
  // so a keyboard-only sequence (no preceding plain click to seed it) kept
  // self-anchoring on whatever row it had just navigated TO, replacing the
  // selection instead of growing it.
  it("Shift+ArrowDown extends the range across TWO consecutive presses (keyboard-only, no prior click)", () => {
    render(<StatefulPeakTable />);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);

    rows[0].focus();
    fireEvent.keyDown(rows[0], { key: "ArrowDown", shiftKey: true });
    // Real keyboard use: focus has moved to rows[1] — the second press
    // fires from THERE, not from rows[0] again.
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown", shiftKey: true });

    expect(rows.map((r) => r.getAttribute("aria-selected"))).toEqual(["true", "true", "true"]);
  });

  it("a THIRD press in the opposite direction still measures from the original anchor, not the last-visited row", () => {
    render(<StatefulPeakTable />);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);

    rows[0].focus();
    fireEvent.keyDown(rows[0], { key: "ArrowDown", shiftKey: true }); // anchor=0, select [0,1]
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown", shiftKey: true }); // select [0,1,2]
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowUp", shiftKey: true }); // back to [0,1]

    expect(rows.map((r) => r.getAttribute("aria-selected"))).toEqual(["true", "true", "false"]);
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

// N2 (red-first): the selected highlight is an inline `style` on the <tr>
// (this file's own PeakTable.tsx), but `.qz-table tr:hover td` (components.css)
// paints an OPAQUE background on the <td> children — which sit on top of the
// <tr> in paint order, so a child's own background always covers whatever
// the parent painted underneath it, independent of CSS specificity or
// inline-vs-class precedence. The fix has to live in the STYLESHEET (no
// jsdom :hover simulation is practical in this suite — see docs/testing.md's
// evidence-standard note on picking a check you can actually run), so this
// pins the exact selector text components.css must carry: the hover rule
// must exclude an `aria-selected="true"` row, which is PeakTable's own
// selected-row marker (see the K1 tests above).
describe("PeakTable — N2 (red-first): the selected-row highlight must survive :hover", () => {
  it("components.css's .qz-table row-hover rule excludes a selected row", () => {
    // Resolved from the repo's vitest root (`frontend/`, `vite.config.ts`'s
    // own working directory) rather than `import.meta.url` — vitest's
    // transform pipeline doesn't always hand back a real `file:` URL for it.
    const cssPath = resolve(process.cwd(), "src/styles/components.css");
    const css = readFileSync(cssPath, "utf8");
    // Without this exclusion, hovering the very row a user just clicked
    // paints an opaque --surface-3 over the selected highlight — the row
    // looks unselected the instant the pointer sits over it, reading as
    // "the click didn't work."
    expect(css).toMatch(/\.qz-table\s+tr:hover:not\(\[aria-selected="true"\]\)\s+td\s*\{/);
  });
});
