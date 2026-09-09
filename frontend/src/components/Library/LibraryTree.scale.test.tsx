// LIBRARY_WORKBOOK_UX_PLAN "Required large-Library engineering safeguards".
// Assertions follow docs/testing.md — the LOAD-INVARIANT property (how many
// rows exist in the DOM, which row is reachable, where focus lands) is the
// contract, never wall-clock timing. jsdom reports zero geometry, so the
// virtualizer's documented deterministic fallbacks (600px viewport / 28px
// rows + 6 overscan rows) define the expected window arithmetic here — see
// useListVirtualization's header.
//
// LibraryTree takes `rows` as a prop (mirrors LibraryTree.test.tsx's own
// harness) so this exercises the real reactive hierarchy, not a frozen array.

import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LibraryTree from "./LibraryTree";
import { VIRTUALIZE_ABOVE } from "./useListVirtualization";
import { useLibraryHierarchyRows } from "./useLibraryHierarchyRows";
import type { Dataset, FolderNode } from "../../lib/types";
import type { WorkbookNode } from "../../lib/workbooks";
import { useApp } from "../../store/useApp";

vi.mock("../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));
vi.mock("../overlays/ParamDialog", () => ({ askParams: vi.fn() }));

const wb = (id: string): WorkbookNode => ({ id, name: id });
const ds = (i: number, workbookId = "w1"): Dataset => ({
  id: `d${i}`,
  name: `run-${String(i).padStart(4, "0")}.csv`,
  workbookId,
  data: { time: [0, 1], values: [[i], [i + 1]], labels: ["signal"], units: ["V"], metadata: {} },
});
/** A folder CHAIN `n` deep, each with one workbook of one worksheet — the
 *  "deep folders" scale fixture the plan names explicitly. */
const deepFolderChain = (n: number): { folders: FolderNode[]; workbooks: WorkbookNode[]; datasets: Dataset[] } => {
  const folders = Array.from({ length: n }, (_, i) => ({
    id: `f${i}`, name: `f${i}`, parentId: i === 0 ? null : `f${i - 1}`, order: 0,
  }));
  const workbooks = Array.from({ length: n }, (_, i) => ({ id: `w${i}`, name: `w${i}`, folderId: `f${i}` }));
  const datasets = Array.from({ length: n }, (_, i) => ({ ...ds(i, `w${i}`) }));
  return { folders, workbooks, datasets };
};

function Harness() {
  const rows = useLibraryHierarchyRows();
  return <LibraryTree rows={rows} onFilterTag={() => {}} />;
}

const seedWide = (count: number): void => {
  useApp.setState({
    workbooks: [wb("w1")],
    datasets: Array.from({ length: count }, (_, i) => ds(i)),
    expandedWorkbookIds: ["w1"],
    librarySelection: { kind: "workbook", id: "w1" },
  });
};

const renderedRows = (): HTMLElement[] =>
  [...document.querySelectorAll<HTMLElement>("[data-lib-row], [data-ds-id]")];

beforeEach(() => {
  useApp.setState({
    folders: [], workbooks: [], datasets: [], originFigures: [], editableFigures: [],
    figureDocs: [], pages: [], reports: [], expandedFolders: [], expandedWorkbookIds: [],
    librarySelection: null, workbookLastChild: {}, activeId: null, selectedIds: [],
    revealTarget: null, confirmRemove: false, trash: [], history: [],
  });
});

describe("LibraryTree — large-Library virtualization", () => {
  it("a 5,000-item WIDE workbook renders a bounded number of row elements, not 5,000", () => {
    seedWide(5000);
    render(<Harness />);
    const rows = renderedRows();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(60); // window + overscan, never O(items)
  });

  it("at or below the threshold every row renders — the small-library DOM is unchanged", () => {
    // VIRTUALIZE_ABOVE - 1 worksheets + 1 workbook row = exactly the
    // threshold; the hook virtualizes only STRICTLY above it.
    seedWide(VIRTUALIZE_ABOVE - 1);
    render(<Harness />);
    expect(renderedRows().length).toBe(VIRTUALIZE_ABOVE);
    const tree = document.querySelector(".qzk-lib-tree") as HTMLElement;
    expect(tree.style.paddingTop).toBe(""); // no virtualization spacers
  });

  it("a 500-deep folder chain (deep folders fixture) also renders a bounded window", () => {
    const { folders, workbooks, datasets } = deepFolderChain(500);
    useApp.setState({
      folders, workbooks, datasets,
      expandedFolders: folders.map((f) => f.id),
      expandedWorkbookIds: workbooks.map((w) => w.id),
    });
    render(<Harness />);
    expect(renderedRows().length).toBeLessThan(80);
  });

  it("Down navigation crosses the rendered-window boundary, scrolling the target into view and focusing it", async () => {
    seedWide(5000);
    render(<Harness />);
    const rows = renderedRows();
    const last = rows[rows.length - 1];
    const lastDsId = last.getAttribute("data-ds-id");
    last.focus();
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(last, { key: "ArrowDown" });

    // The retry is rAF-deferred (the target row isn't mounted on the same
    // tick ensureVisible's scroll triggers the re-render) — same contract
    // as LibraryWorkspace's tile-window arrow-nav test.
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement).not.toBe(last);
    });
    const focused = document.activeElement as HTMLElement;
    expect(focused.matches("[data-lib-row], [data-ds-id]")).toBe(true);
    expect(focused.getAttribute("data-ds-id")).not.toBe(lastDsId);
  });

  // REVIEW ROUND. Covers the general recovery path: deleting the focused row
  // must never leave focus orphaned on <body>, because body focus plus the
  // Delete keybinding is the data-loss path `lib/focusGuard.ts` exists to
  // prevent.
  //
  // HONEST LIMIT — read before trusting this as proof. The review's specific
  // finding was an INTERACTION: the keep-the-selection-visible effect ran after
  // the recovery effect and overrode its window, orphaning focus. That
  // interaction is fixed by construction (the recovery claims the window for
  // its render via `recoveringRef`, and the selection effect is keyed on the
  // stable selection key so it no longer fires on unrelated rebuilds) — but
  // this test does NOT reproduce it: it passes against the defective version
  // too, because jsdom does not orphan focus to <body> here the way a real
  // browser does. It is kept as a guard against recovery breaking outright,
  // not presented as evidence for the interaction. The sibling test below —
  // "an unrelated rename does not yank the window back" — DOES fail against
  // the defect, and is the real regression guard for this fix.
  it("deleting the focused row never leaves focus orphaned on <body>", async () => {
    seedWide(5000);
    // Select a row far from the focused one, so the selection effect has
    // somewhere else it would rather scroll to.
    useApp.setState({ selectedIds: ["d0"], librarySelection: null });
    render(<Harness />);

    // Scroll AWAY from the selection first. This is essential: with the window
    // still at the top, the selection effect's ensureVisible(0) is a no-op and
    // the bug cannot show. My first version of this test omitted it and passed
    // against the defect — vacuous.
    const first = renderedRows()[renderedRows().length - 1];
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).not.toBe(first));

    const rows = renderedRows();
    const victim = rows[Math.floor(rows.length / 2)];
    const victimId = victim.getAttribute("data-ds-id")!;
    victim.focus();
    expect(document.activeElement).toBe(victim);

    // Remove the focused row from the model, exactly as a delete would.
    act(() => {
      useApp.setState({
        datasets: useApp.getState().datasets.filter((d) => d.id !== victimId),
      });
    });

    await waitFor(() => {
      // The whole point: focus must NOT be orphaned onto <body>.
      expect(document.activeElement).not.toBe(document.body);
    });
    expect((document.activeElement as HTMLElement).matches("[data-lib-row], [data-ds-id]")).toBe(true);
  });

  // The other half of the same defect: an unrelated model change must not drag
  // the window back to the selection while the user is reading elsewhere.
  it("an unrelated rename does not yank the window back to the selected row", async () => {
    seedWide(5000);
    useApp.setState({ selectedIds: ["d0"], librarySelection: null });
    render(<Harness />);

    // Scroll far away from the selection.
    const target = renderedRows()[renderedRows().length - 1];
    target.focus();
    fireEvent.keyDown(target, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).not.toBe(target));
    const before = renderedRows().map((r) => r.getAttribute("data-ds-id"));

    act(() => {
      useApp.setState({
        datasets: useApp.getState().datasets.map((d) =>
          d.id === "d400" ? { ...d, name: "renamed" } : d,
        ),
      });
    });

    const after = renderedRows().map((r) => r.getAttribute("data-ds-id"));
    expect(after[0]).toBe(before[0]); // window unchanged, not reset to d0
  });

  it("Show in Library reveals and scrolls to a worksheet outside the rendered window", async () => {
    seedWide(5000);
    render(<Harness />);
    expect(document.querySelector('[data-ds-id="d3000"]')).toBeNull(); // not yet rendered

    // The reveal path (Library.tsx in production) selects the node via
    // selectLibraryNode, which also clears librarySelection (L0.25's mutual-
    // exclusion contract — see libraryOpen.ts) so the worksheet, not the
    // still-selected workbook, is what selectedRow resolves to.
    act(() => {
      useApp.setState({ selectedIds: ["d3000"], librarySelection: null });
    });

    await waitFor(() => {
      expect(document.querySelector('[data-ds-id="d3000"]')).not.toBeNull();
    });
  });

  it("Right-arrow multiselect range spans rows never rendered together — selection is data-indexed, not DOM-scoped", () => {
    seedWide(5000);
    render(<Harness />);
    useApp.getState().selectIds(["d0"]); // anchor = activeId, per selectRange's contract
    useApp.setState({ activeId: "d0" });

    // Scroll far away and shift-click a row that was never in the same
    // rendered window as the anchor.
    useApp.getState().selectRange("d3000");

    const selected = useApp.getState().selectedIds;
    expect(selected).toHaveLength(3001);
    expect(selected[0]).toBe("d0");
    expect(selected[3000]).toBe("d3000");
  });

  it("rapid view-mode-style remounts (unmount mid-scroll, remount) complete without a blank tree", () => {
    seedWide(5000);
    const { unmount } = render(<Harness />);
    const panel = document.querySelector(".qzk-lib-tree") as HTMLElement;
    fireEvent.scroll(panel, { target: { scrollTop: 40000 } });
    unmount();
    render(<Harness />);
    expect(renderedRows().length).toBeGreaterThan(0);
  });

  it("a shrunken item count under a stale deep scroll still renders rows (clamped window, never blank)", () => {
    seedWide(5000);
    // No live selection — isolates the clamped-window math from the
    // separate "keep the selected row visible" effect (which would itself
    // scroll back near the top once `rows` changes underneath it).
    useApp.setState({ librarySelection: null });
    render(<Harness />);
    const panel = document.querySelector(".qzk-lib-tree") as HTMLElement;
    fireEvent.scroll(panel, { target: { scrollTop: 130000 } }); // near the bottom of 5000 rows
    expect(renderedRows().length).toBeGreaterThan(0);

    // Most of the 5000 rows vanish out from under the scrolled window (e.g.
    // a bulk delete) without any scroll reset — still well above
    // VIRTUALIZE_ABOVE, so the window stays on the clamped-math path
    // (not the "small library, render everything" escape hatch).
    act(() => {
      useApp.setState({ datasets: Array.from({ length: 300 }, (_, i) => ds(i)) });
    });
    expect(renderedRows().length).toBeGreaterThan(0); // lib/gridwindow clamping
  });

  it("expanding a row's optional preview (DatasetRowPreview) at the window boundary doesn't break crossing into the unrendered rows", async () => {
    seedWide(5000);
    render(<Harness />);
    const rows = renderedRows();
    const last = rows[rows.length - 1];
    // Expand the compact row's optional preview (a taller row — the
    // documented uniform-row-approximation case) right at the boundary,
    // THEN cross it — the approximation must not desync the window math.
    const toggle = last.querySelector<HTMLElement>("button.qz-icon-btn");
    toggle?.click();
    last.focus();

    fireEvent.keyDown(last, { key: "ArrowDown" });

    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement).not.toBe(last);
    });
  });
});
