// BUGS_AND_ISSUES UX-001, the open "Document what each existing icon and
// badge means..." research item's remaining half: "a full icon/badge audit
// across every row kind is still open" (the prior UX-001 pass only covered
// DatasetRow/DatasetRowParts, which it says explicitly). This is that audit,
// made durable as a test rather than a one-time read-through: every
// icon-only interactive control (a `<button>` or `role="button"` element
// whose own visible content is a bare glyph, not a readable word) in each
// Library TREE row kind — DatasetRow (both its compact Tree layout and its
// full flat-list card), FigureRow, WorkbookRow, FolderRow, ArtifactRow (the
// dispatcher names in LibraryTree.tsx's switch) — must carry an `aria-label`
// or a `title` (BUGS_AND_ISSUES' own acceptance wording). A control whose
// visible text is already a real word/number (e.g. ArtifactRow's own
// "<glyph> name" button, a tag chip's text) already has a readable name from
// its content and is not "icon-only".
//
// Read-through finding (not a test failure — recorded here since the audit
// asked for one): no duplicated action was found among these controls'
// aria-label/title text within any one row — each icon-only control names a
// distinct action (drag/menu/expand/duplicate/remove/move/tag-add/tag-remove/
// preview-toggle/open-in-new-window/etc.).

import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import ArtifactRow from "./ArtifactRows";
import DatasetRow from "./DatasetRow";
import FigureRow from "./FigureRow";
import FolderRow from "./FolderRow";
import WorkbookRow from "./WorkbookRow";
import { createFigureDocument } from "../../lib/figureDocument";
import { buildLibraryHierarchy, type LibraryNode } from "../../lib/libraryHierarchy";
import type { OriginFigureEntry } from "../../lib/originFigures";
import { defaultPlotView } from "../../lib/plotview";
import type { Dataset, FolderNode } from "../../lib/types";
import type { WorkbookNode } from "../../lib/workbooks";
import { useApp } from "../../store/useApp";

/** Every icon-only `<button>`/`role="button"` element under `container` that
 *  has NEITHER an `aria-label` NOR a `title` — i.e. a control with no
 *  accessible name at all, save for whatever a screen reader makes of a bare
 *  glyph. A control whose own text content already contains a real (2+
 *  character) word or number already has a readable name from its content,
 *  so it's excluded (this is the ArtifactRow / tag-chip / "G" carve-out —
 *  "G" itself is excluded too since FigureRow's Remake button also carries a
 *  `title`, so it never actually reaches the offender list either way). */
function iconOnlyControlsMissingAccessibleName(container: HTMLElement): string[] {
  const controls = container.querySelectorAll<HTMLElement>('button, [role="button"]');
  const offenders: string[] = [];
  controls.forEach((el) => {
    const text = (el.textContent ?? "").trim();
    const hasWordContent = /[A-Za-z]{2,}|\d{2,}/.test(text);
    if (hasWordContent) return; // already has a readable name from its content
    if (!el.getAttribute("aria-label") && !el.getAttribute("title")) {
      offenders.push(el.outerHTML.slice(0, 140));
    }
  });
  return offenders;
}

/** A NON-interactive icon/count "badge" leaf `<span>` — informative only, no
 *  onClick — still needs a `title` for the same reason an icon-only button
 *  needs an aria-label: a bare glyph or number reads as nothing on its own.
 *  Every OTHER badge of this shape already carries one (RecomputedMark's
 *  "↻", DerivedWorksheetMark's "⇢", DatasetRowParts' stale "●" dot,
 *  WorkbookRow's own worksheet-count chip) — this targets the ONE
 *  inconsistency the audit actually found: FolderRow's count chip is the
 *  same badge as WorkbookRow's sibling but was never given one. */
function badgeMissingTitle(el: HTMLElement | null): boolean {
  return el != null && !el.getAttribute("title") && !el.getAttribute("aria-label");
}

const plainDataset: Dataset = {
  id: "d1",
  name: "sample.dat",
  data: { time: [0, 1], values: [[1], [2]], labels: ["A"], units: [""], metadata: {} },
};

const datasetRowBaseProps = {
  active: false,
  selected: false,
  showReorder: true, // include the Move up/down icon buttons in the audit too
  canMoveUp: true,
  canMoveDown: true,
  onFilterTag: () => {},
};

const figureEntry: OriginFigureEntry = {
  id: "g1",
  stem: "Moke",
  datasetId: "d1",
  siblingIds: ["d1"],
  figure: {
    name: "MokeGraph",
    x_from: 0,
    x_to: 1,
    x_log: false,
    y_from: 0,
    y_to: 1,
    y_log: false,
    n_curves: 1,
    annotations: [],
  },
};

const wb = (id: string, name = id): WorkbookNode => ({ id, name });
const workbookNode = (id: string) => {
  const hierarchy = buildLibraryHierarchy({
    folders: [],
    workbooks: [wb(id)],
    datasets: [plainDataset],
  });
  const node = hierarchy.byKey.get(`workbook:${id}`);
  if (!node || node.kind !== "workbook") throw new Error("fixture workbook missing");
  return node as Extract<LibraryNode, { kind: "workbook" }>;
};

const folder: FolderNode = { id: "f1", name: "Folder", parentId: null, order: 0 };

beforeEach(() => {
  useApp.setState({
    datasets: [{ ...plainDataset, workbookId: "w1" }],
    workbooks: [wb("w1")],
    folders: [folder],
    originFigures: [figureEntry],
    activeId: null,
    selectedIds: [],
    staleDatasets: [],
    staleFits: [],
    librarySelection: null,
    expandedFolders: [],
    expandedWorkbookIds: [],
    workbookLastChild: {},
  });
});

describe("Library row kinds — every icon-only control has an accessible name (UX-001 tree-wide icon audit)", () => {
  it("DatasetRow — full card layout (flat list / Smart Folders)", () => {
    const { container } = render(<DatasetRow dataset={plainDataset} {...datasetRowBaseProps} />);
    expect(iconOnlyControlsMissingAccessibleName(container)).toEqual([]);
  });

  it("DatasetRow — compact Tree row layout", () => {
    const { container } = render(<DatasetRow dataset={plainDataset} {...datasetRowBaseProps} treeMode />);
    expect(iconOnlyControlsMissingAccessibleName(container)).toEqual([]);
  });

  it("FigureRow", () => {
    const { container } = render(<FigureRow entry={figureEntry} treeMode />);
    expect(iconOnlyControlsMissingAccessibleName(container)).toEqual([]);
  });

  it("WorkbookRow", () => {
    const { container } = render(<WorkbookRow node={workbookNode("w1")} depth={0} expanded hasChildren />);
    expect(iconOnlyControlsMissingAccessibleName(container)).toEqual([]);
  });

  it("FolderRow", () => {
    const { container } = render(<FolderRow folder={folder} depth={0} count={2} expanded />);
    expect(iconOnlyControlsMissingAccessibleName(container)).toEqual([]);
  });

  it("ArtifactRow", () => {
    const hierarchy = buildLibraryHierarchy({
      folders: [],
      workbooks: [wb("w1")],
      datasets: [{ ...plainDataset, workbookId: "w1" }],
      editableFigures: [
        createFigureDocument({ id: "fig1", name: "My Figure", datasetId: "d1", view: defaultPlotView() }),
      ],
    });
    const node = hierarchy.byKey.get("editable-figure:fig1");
    if (!node || node.kind !== "editable-figure") throw new Error("fixture editable-figure missing");
    const { container } = render(
      <ArtifactRow node={node as Extract<LibraryNode, { kind: "editable-figure" }>} depth={0} />,
    );
    expect(iconOnlyControlsMissingAccessibleName(container)).toEqual([]);
  });
});

describe("Library row kinds — informative count/icon BADGES also carry a title (UX-001 tree-wide icon audit)", () => {
  it("FolderRow's dataset-count chip has a title, matching WorkbookRow's own worksheet-count chip", () => {
    const { container } = render(<FolderRow folder={folder} depth={0} count={2} expanded />);
    expect(badgeMissingTitle(container.querySelector(".qzk-group-count"))).toBe(false);
  });

  it("WorkbookRow's worksheet-count chip has a title (the established convention this mirrors)", () => {
    const { container } = render(<WorkbookRow node={workbookNode("w1")} depth={0} expanded hasChildren />);
    expect(badgeMissingTitle(container.querySelector(".qzk-group-count"))).toBe(false);
  });
});
