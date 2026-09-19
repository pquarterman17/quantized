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
//
// UX-004 (2026-09-19). What this audit checked was that each mark was
// LABELLED. It did NOT check that two marks were DISTINGUISHABLE from each
// other, and that is precisely the gap the owner then hit: three entity kinds
// rendered as ▦ and two more as ▤, every one of them correctly titled. The
// distinguishability half now lives in `nodeIcons.test.ts` (injectivity over
// the complete kind set). Added here, because they are row-rendering facts
// this file is the natural home for:
//   * the rendered type glyph of each row kind IS the one the shared
//     vocabulary declares for that kind (so the injective map is the map the
//     DOM actually shows), and each carries its plain-language title;
//   * the worksheet row's preview toggle, now a hover/focus resting cue,
//     stays in the DOM, keyboard-focusable and accessibly named.

import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import ArtifactRow from "./ArtifactRows";
import DatasetRow from "./DatasetRow";
import FigureRow from "./FigureRow";
import FolderRow from "./FolderRow";
import { LIBRARY_NODE_GLYPH, LIBRARY_NODE_LABEL } from "./nodeIcons";
import WorkbookRow from "./WorkbookRow";
import { createFigureDocument } from "../../lib/figureDocument";
import {
  buildLibraryHierarchy,
  type LibraryNode,
  type LibraryNodeKind,
} from "../../lib/libraryHierarchy";
import { flatRules, readShellCss } from "../../styles/cssRules.testkit";
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

const editableFigureNode = () => {
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
  return node as Extract<LibraryNode, { kind: "editable-figure" }>;
};

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
    const { container } = render(<ArtifactRow node={editableFigureNode()} depth={0} />);
    expect(iconOnlyControlsMissingAccessibleName(container)).toEqual([]);
  });
});

describe("Library row kinds — the rendered type mark IS the shared vocabulary's (UX-004)", () => {
  /** The row's type glyph: the titled, aria-hidden span the row renders for
   *  its kind. Asserts both that it exists and that it shows the ONE mark
   *  `nodeIcons.ts` assigns that kind — the DOM-layer other half of
   *  `nodeIcons.test.ts`'s injectivity proof. */
  function expectTypeMark(container: HTMLElement, kind: LibraryNodeKind) {
    const mark = container.querySelector<HTMLElement>(`[title="${LIBRARY_NODE_LABEL[kind]}"]`);
    expect(mark, `no glyph titled "${LIBRARY_NODE_LABEL[kind]}"`).not.toBeNull();
    expect(mark?.textContent?.trim()).toBe(LIBRARY_NODE_GLYPH[kind]);
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
  }

  it("FolderRow renders the Folder mark", () => {
    const { container } = render(<FolderRow folder={folder} depth={0} count={2} expanded />);
    expectTypeMark(container, "folder");
  });

  it("WorkbookRow renders the Workbook mark", () => {
    const { container } = render(<WorkbookRow node={workbookNode("w1")} depth={0} expanded hasChildren />);
    expectTypeMark(container, "workbook");
  });

  it("DatasetRow (compact Tree row) renders the Worksheet mark", () => {
    const { container } = render(<DatasetRow dataset={plainDataset} {...datasetRowBaseProps} treeMode />);
    expectTypeMark(container, "worksheet");
  });

  it("FigureRow renders the Origin-figure mark", () => {
    const { container } = render(<FigureRow entry={figureEntry} treeMode />);
    expectTypeMark(container, "origin-figure");
  });

  it("ArtifactRow renders the Editable-figure mark", () => {
    const { container } = render(<ArtifactRow node={editableFigureNode()} depth={0} />);
    expectTypeMark(container, "editable-figure");
  });

  it("the four tree row kinds rendered together show four DIFFERENT marks", () => {
    // The owner's actual complaint, at the DOM layer: in one tree, adjacent
    // rows of different kinds must not paint the same character.
    const marks = [
      render(<FolderRow folder={folder} depth={0} count={2} expanded />),
      render(<WorkbookRow node={workbookNode("w1")} depth={0} expanded hasChildren />),
      render(<DatasetRow dataset={plainDataset} {...datasetRowBaseProps} treeMode />),
      render(<FigureRow entry={figureEntry} treeMode />),
    ].map(({ container }) =>
      container.querySelector(".qzk-folder-icon, .qzk-workbook-icon, .qzk-ds-icon")?.textContent?.trim(),
    );
    expect(marks.every((m) => m && m.length > 0)).toBe(true);
    expect(new Set(marks).size).toBe(marks.length);
  });
});

describe("Library rows — resting cues stay keyboard-reachable and named (UX-004 density)", () => {
  it("the worksheet preview toggle is a resting cue, still in the DOM, focusable and named", () => {
    const { container } = render(<DatasetRow dataset={plainDataset} {...datasetRowBaseProps} treeMode />);
    const toggle = container.querySelector<HTMLButtonElement>(".qzk-ds-preview-btn");
    expect(toggle).not.toBeNull();
    // Hidden by OPACITY only (shell.css), so it keeps its box and its place
    // in the tab order — never `hidden`/`display:none`/`aria-hidden`.
    expect(toggle?.hasAttribute("hidden")).toBe(false);
    expect(toggle?.getAttribute("aria-hidden")).toBeNull();
    expect(toggle?.getAttribute("tabindex")).toBeNull(); // a <button>: focusable by default
    expect(toggle?.getAttribute("aria-label")).toBe("Show preview");
    toggle?.focus();
    expect(document.activeElement).toBe(toggle);
  });

  it("shell.css hides it at rest but paints it on row hover, on focus, and while expanded", () => {
    // Parsed from the sheet text (the established `cssRules.testkit`
    // pattern), not assumed: jsdom lays nothing out, so the rule IS the
    // evidence here.
    const rules = flatRules(readShellCss()).filter((r) => r.selector.includes(".qzk-ds-preview-btn"));
    expect(rules.length).toBeGreaterThan(0);
    const restRule = rules.find((r) => r.selector.trim() === ".qzk-ds-preview-btn");
    expect(restRule?.body.replace(/\s/g, "")).toContain("opacity:0");
    const text = rules.map((r) => `${r.selector} { ${r.body} }`).join(" ");
    // Never these — they would take the control out of the tab order or hide
    // it from assistive tech.
    expect(text).not.toContain("display: none");
    expect(text).not.toContain("visibility: hidden");
    expect(text).toContain(".qzk-ds:hover .qzk-ds-preview-btn");
    expect(text).toContain(".qzk-ds-preview-btn:focus-visible");
    expect(text).toContain('.qzk-ds-preview-btn[aria-pressed="true"]');
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
