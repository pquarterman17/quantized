// UX-001 (plans/BUGS_AND_ISSUES.md) — two residual acceptance-criteria boxes,
// tested end to end through the real `LibraryTree` (not just `DatasetRow` in
// isolation, which `DatasetRowCompact.test.tsx` already covers):
//
//   (a) "At least six worksheet rows are comfortably visible in a typical-
//       height Library without scrolling past large previews."
//   (b) "Names and action meanings are recoverable even when the Library is
//       narrow."
//
// Render harness mirrors LibraryTree.test.tsx's own `Harness`/fixture pattern
// (read there, not imported — that file is owned by another workstream and is
// left untouched) so this exercises the real reactive hierarchy-flattening
// path, not a hand-built row array.
//
// (a) is only PARTLY established here, and honestly so: `shell.css` declares
// `.qzk-ds.qzk-ds-compact`'s padding (3px 4px, versus the full card's 8px 9px)
// but no `height` or `line-height` for the compact row or its text — the
// remaining vertical space a rendered row occupies comes from the browser's
// font-metric default line-height, which is neither declared in the
// stylesheet nor computed by jsdom's layout-free DOM. So this test proves the
// two structural facts that ARE knowable from the DOM + parsed CSS text alone
// (single-line, no preview/thumbnail child by default; a measurably smaller
// declared padding than the full card) and stops short of the numeric
// "6 rows in 480px" claim, which needs a real browser to establish. That box
// stays unticked in the plan, with this test cited as the honest partial
// evidence.

import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import LibraryTree from "./LibraryTree";
import { useLibraryHierarchyRows } from "./useLibraryHierarchyRows";
import { declares, flatRules, readShellCss } from "../../styles/cssRules.testkit";
import type { Dataset, FolderNode } from "../../lib/types";
import type { WorkbookNode } from "../../lib/workbooks";
import { useApp } from "../../store/useApp";

const wb = (id: string, folderId?: string): WorkbookNode => ({ id, name: id, folderId });
const ds = (id: string, name: string, workbookId: string, order: number): Dataset => ({
  id,
  name,
  data: { time: [0, 1], values: [[1], [2]], labels: ["M"], units: [""], metadata: {} },
  workbookId,
  order,
});

const noop = () => {};

function Harness() {
  const rows = useLibraryHierarchyRows();
  return <LibraryTree rows={rows} onFilterTag={noop} />;
}

const WORKSHEET_COUNT = 8;
const LONG_NAME =
  "a_very_long_reflectometry_worksheet_name_that_would_overflow_a_narrow_Library_panel.dat";

function eightWorksheets(): Dataset[] {
  const names = Array.from({ length: WORKSHEET_COUNT }, (_, i) => (i === 0 ? LONG_NAME : `sheet${i}.dat`));
  return names.map((name, i) => ds(`d${i}`, name, "w1", i));
}

beforeEach(() => {
  useApp.setState({
    folders: [] as FolderNode[],
    workbooks: [wb("w1")],
    datasets: eightWorksheets(),
    originFigures: [],
    editableFigures: [],
    figureDocs: [],
    pages: [],
    reports: [],
    expandedFolders: [],
    expandedWorkbookIds: ["w1"],
    librarySelection: null,
    workbookLastChild: {},
    activeId: null,
    selectedIds: [],
  });
});

function worksheetRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-ds-id]")];
}

describe("LibraryTree — compact worksheet rows, ≥6-visible acceptance criterion (UX-001, box a)", () => {
  it("renders every worksheet as a single compact line with no preview/thumbnail child by default", () => {
    render(<Harness />);
    const rows = worksheetRows();
    expect(rows).toHaveLength(WORKSHEET_COUNT);
    for (const row of rows) {
      const card = row.closest(".qzk-ds") ?? row;
      expect(card).toHaveClass("qzk-ds-compact");
      // No thumbnail mounted by default (the opt-in Sparkline preview toggle
      // is a separate, user-initiated action — untouched by this test).
      expect(card.querySelector(".qzk-ds-spark")).toBeNull();
      // The full card's always-visible actions footer is gone in Tree mode.
      expect(card.querySelector(".qzk-ds-foot")).toBeNull();
    }
  });

  it("the compact row's declared padding is measurably smaller than the full card's", () => {
    // Structural, CSS-text evidence for "more rows fit" — NOT a pixel-height
    // proof (see file header): the compact modifier trims 5px off each side
    // of the base card's padding, the only vertical-space number the
    // stylesheet actually commits to.
    const rules = flatRules(readShellCss());
    const base = rules.find((r) => r.selector === ".qzk-ds");
    const compact = rules.find((r) => r.selector === ".qzk-ds.qzk-ds-compact");
    expect(base).toBeDefined();
    expect(compact).toBeDefined();
    expect(declares(base!.body, "padding", "8px 9px")).toBe(true);
    expect(declares(compact!.body, "padding", "3px 4px")).toBe(true);
  });
});

describe("LibraryTree — narrow-panel name/action recoverability (UX-001, box b)", () => {
  it("every worksheet row's name element carries its full name as a tooltip", () => {
    render(<Harness />);
    const rows = worksheetRows();
    expect(rows).toHaveLength(WORKSHEET_COUNT);
    const longRow = rows.find((r) => r.getAttribute("data-ds-id") === "d0")!;
    const nameEl = longRow.querySelector(".qzk-ds-name")!;
    expect(nameEl).not.toBeNull();
    // The full name is RECOVERABLE from the tooltip even though the on-screen
    // text may be visually clipped by the ellipsis rule below.
    expect(nameEl.getAttribute("title")).toContain(LONG_NAME);
  });

  it("the name's CSS rule clips with an ellipsis rather than wrapping or silently cutting text", () => {
    const rules = flatRules(readShellCss());
    const nameRule = rules.find((r) => r.selector === ".qzk-ds-name");
    expect(nameRule).toBeDefined();
    expect(declares(nameRule!.body, "overflow", "hidden")).toBe(true);
    expect(declares(nameRule!.body, "text-overflow", "ellipsis")).toBe(true);
    expect(declares(nameRule!.body, "white-space", "nowrap")).toBe(true);
  });
});
