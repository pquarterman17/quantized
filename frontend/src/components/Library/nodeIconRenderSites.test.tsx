// UX-004, review round 1. `nodeIcons.test.ts` proves the VOCABULARY is
// injective; `rowIconAccessibility.test.tsx` proves each mark is labelled.
// Neither proves the WIRING: that a given render site reaches for its own
// kind's entry in the map rather than some other kind's.
//
// The reviewer demonstrated the gap by pointing `ReportsSection.tsx` and
// `SavedFiguresSection.tsx` at `LIBRARY_NODE_GLYPH.folder`. Every test in the
// suite stayed green — a Report/Folder and a Publication-figure/Folder
// collision, reintroduced with nothing red. That is the exact defect class
// UX-004 was filed to close, one level down.
//
// This file is the table-driven closure of it, chosen over adding two more
// one-off cases so that the NEXT kind added cannot be missed: the table is
// asserted to cover every member of `LIBRARY_NODE_KINDS`, so a ninth kind
// fails here until its render site is listed.
//
// Scope note — only sites that name a kind LITERALLY can be miswired.
// `ArtifactRows.tsx`, `CollectionsSection.tsx`, `DetailsRow.tsx` and
// `TilePreview.tsx` all index the shared map by `node.kind`, so their mark is
// correct by construction and no table entry can add information about them.
// The eight literal sites are all listed below. (`Library.tsx`'s "New folder"
// toolbar button is the ninth literal site; it is a COMMAND, covered by
// `nodeIcons.test.ts`'s "a command that claims to name a kind really wears
// that kind's mark".)

import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import DatasetRow from "./DatasetRow";
import EditableFiguresSection from "./EditableFiguresSection";
import FigureRow from "./FigureRow";
import FolderRow from "./FolderRow";
import { LIBRARY_NODE_GLYPH, LIBRARY_NODE_KINDS, LIBRARY_NODE_LABEL } from "./nodeIcons";
import PagesSection from "./PagesSection";
import ReportsSection from "./ReportsSection";
import SavedFiguresSection from "./SavedFiguresSection";
import WorkbookRow from "./WorkbookRow";
import { createFigureDocument } from "../../lib/figureDocument";
import type { FigureDoc } from "../../lib/figuredoc";
import { buildLibraryHierarchy, type LibraryNode, type LibraryNodeKind } from "../../lib/libraryHierarchy";
import type { OriginFigureEntry } from "../../lib/originFigures";
import { createPageDocument } from "../../lib/pageDocumentActions";
import { defaultPlotView } from "../../lib/plotview";
import type { ReportEntry } from "../../lib/report";
import type { Dataset, FolderNode } from "../../lib/types";
import type { WorkbookNode } from "../../lib/workbooks";
import { useApp } from "../../store/useApp";

const dataset: Dataset = {
  id: "d1",
  name: "sample.dat",
  workbookId: "w1",
  data: { time: [0, 1], values: [[1], [2]], labels: ["A"], units: [""], metadata: {} },
};
const workbook: WorkbookNode = { id: "w1", name: "Book1" };
const folder: FolderNode = { id: "f1", name: "Project", parentId: null, order: 0 };

const originFigure: OriginFigureEntry = {
  id: "g1",
  stem: "Moke",
  datasetId: "d1",
  siblingIds: ["d1"],
  figure: {
    name: "MokeGraph",
    x_from: 0, x_to: 1, x_log: false,
    y_from: 0, y_to: 1, y_log: false,
    n_curves: 1,
    annotations: [],
  },
};

const editableFigure = createFigureDocument({
  id: "fig1", name: "My Figure", datasetId: "d1", view: defaultPlotView(),
});

const page = createPageDocument({ id: "p1", name: "My page" });

const report: ReportEntry = {
  id: "rep1",
  name: "Linear fit",
  datasetId: "d1",
  report: { title: "Linear fit", sections: [{ title: "Fit", blocks: [{ type: "text", text: "Model" }] }] },
};

const publicationFigure: FigureDoc = {
  id: "figd1",
  name: "MH loop",
  datasetId: "d1",
  live: true,
  config: {
    xKey: null, yKeys: [0], xScale: "linear", yScale: "linear",
    title: "", xLabel: "", yLabel: "", style: "aps", fmt: "pdf", dpi: 300,
    overrides: null, seriesStyles: null,
  },
};

const workbookNode = () => {
  const node = buildLibraryHierarchy({ folders: [], workbooks: [workbook], datasets: [dataset] })
    .byKey.get("workbook:w1");
  if (!node || node.kind !== "workbook") throw new Error("fixture workbook missing");
  return node as Extract<LibraryNode, { kind: "workbook" }>;
};

const datasetRowProps = {
  active: false,
  selected: false,
  showReorder: false,
  canMoveUp: false,
  canMoveDown: false,
  onFilterTag: () => {},
};

/** One place a node kind's mark is written out by NAME rather than looked up
 *  by `node.kind` — i.e. one place a future edit could reach for the wrong
 *  kind's entry, silently recreating a collision. */
interface RenderSite {
  kind: LibraryNodeKind;
  /** The component file the mark is written in — named so a failure points
   *  straight at the line to fix. */
  where: string;
  render: () => HTMLElement;
}

const SITES: readonly RenderSite[] = [
  {
    kind: "folder",
    where: "FolderRow.tsx",
    render: () => render(<FolderRow folder={folder} depth={0} count={1} expanded />).container,
  },
  {
    kind: "workbook",
    where: "WorkbookRow.tsx",
    render: () => render(<WorkbookRow node={workbookNode()} depth={0} expanded hasChildren />).container,
  },
  {
    kind: "worksheet",
    where: "DatasetRow.tsx (compact Tree row)",
    render: () => render(<DatasetRow dataset={dataset} {...datasetRowProps} treeMode />).container,
  },
  {
    kind: "origin-figure",
    where: "FigureRow.tsx",
    render: () => render(<FigureRow entry={originFigure} treeMode />).container,
  },
  {
    kind: "editable-figure",
    where: "EditableFiguresSection.tsx",
    render: () => render(<EditableFiguresSection />).container,
  },
  {
    kind: "publication-figure",
    where: "SavedFiguresSection.tsx",
    render: () => render(<SavedFiguresSection />).container,
  },
  {
    kind: "page",
    where: "PagesSection.tsx",
    render: () => render(<PagesSection />).container,
  },
  {
    kind: "report",
    where: "ReportsSection.tsx",
    render: () => render(<ReportsSection />).container,
  },
];

beforeEach(() => {
  useApp.setState({
    datasets: [dataset],
    workbooks: [workbook],
    folders: [folder],
    originFigures: [originFigure],
    editableFigures: [editableFigure],
    figureDocs: [publicationFigure],
    pages: [page],
    reports: [report],
    activeId: null,
    selectedIds: [],
    staleDatasets: [],
    staleFits: [],
    librarySelection: null,
    expandedFolders: [],
    expandedWorkbookIds: [],
    workbookLastChild: {},
    figurePublicationSession: null,
  });
});

describe("UX-004 — every kind's render site draws ITS OWN kind's mark", () => {
  it("the table covers every node kind (a new kind cannot be missed)", () => {
    expect([...new Set(SITES.map((s) => s.kind))].sort()).toEqual([...LIBRARY_NODE_KINDS].sort());
  });

  it.each(SITES.map((site) => [site.kind, site.where, site] as const))(
    "%s — %s",
    (kind, where, site) => {
      const container = site.render();
      // The type mark is the span titled with this kind's plain-language
      // name. Asserting BOTH halves is the point: a site wired to another
      // kind's entry would render that kind's glyph under this kind's title
      // (the reviewer's sabotage), or this kind's glyph under the wrong
      // title — either way one of these two fails.
      const mark = container.querySelector<HTMLElement>(`[title="${LIBRARY_NODE_LABEL[kind]}"]`);
      expect(mark, `${where}: no glyph titled "${LIBRARY_NODE_LABEL[kind]}"`).not.toBeNull();
      expect(mark?.textContent?.trim(), `${where}: wrong glyph for ${kind}`).toBe(
        LIBRARY_NODE_GLYPH[kind],
      );
      // And no OTHER kind's mark leaked into this row.
      const foreign = LIBRARY_NODE_KINDS.filter((k) => k !== kind)
        .filter((k) => container.querySelector(`[title="${LIBRARY_NODE_LABEL[k]}"]`) != null);
      expect(foreign, `${where}: also rendered another kind's mark`).toEqual([]);
    },
  );
});
