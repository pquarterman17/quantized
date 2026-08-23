// LIBRARY_WORKBOOK_UX_PLAN PR C: the light tree rows for editable figures,
// publication figures, pages, and reports. A click opens via the shared
// openLibraryNode dispatcher and records L0.6's workbookLastChild for the
// owning workbook.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import ArtifactRow from "./ArtifactRows";
import { createFigureDocument } from "../../lib/figureDocument";
import type { FigureDoc } from "../../lib/figuredoc";
import {
  buildLibraryHierarchy,
  type LibraryHierarchyInput,
  type LibraryNode,
  type LibraryNodeKey,
} from "../../lib/libraryHierarchy";
import { createPageDocument } from "../../lib/pageDocumentActions";
import { defaultPlotView } from "../../lib/plotview";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";

type Artifact = Extract<LibraryNode, { kind: "editable-figure" | "publication-figure" | "page" | "report" }>;

const boundDataset: Dataset = {
  id: "d1", name: "d1.dat", workbookId: "w1",
  data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} },
};

const pubFigure = (id: string, datasetId: string | null, style = "line"): FigureDoc => ({
  id,
  name: "My Pub",
  datasetId,
  live: true,
  config: {
    xKey: null, yKeys: null, xScale: "linear", yScale: "linear",
    title: "", xLabel: "", yLabel: "", style, fmt: "png", dpi: 150,
    overrides: null, seriesStyles: null,
  },
});

beforeEach(() => {
  useApp.setState({
    workbooks: [{ id: "w1", name: "W" }],
    datasets: [boundDataset],
    folders: [],
    activeId: null,
    openReportId: null,
    workbookLastChild: {},
  });
});

function nodeOf(kind: Artifact["kind"], key: LibraryNodeKey, input: Partial<LibraryHierarchyInput> = {}): Artifact {
  const hierarchy = buildLibraryHierarchy({
    folders: [],
    workbooks: [{ id: "w1", name: "W" }],
    datasets: [boundDataset],
    editableFigures: [createFigureDocument({ id: "fig1", name: "My Figure", datasetId: "d1", view: defaultPlotView() })],
    publicationFigures: [pubFigure("pub1", "d1")],
    pages: [createPageDocument({ id: "pg1", name: "My Page", rows: 2, cols: 3 })],
    reports: [{ id: "rep1", name: "My Report", datasetId: "d1", report: { rows: [] } as never }],
    ...input,
  });
  const node = hierarchy.byKey.get(key);
  if (!node || node.kind !== kind) throw new Error(`fixture ${key} missing or wrong kind`);
  return node as Artifact;
}

describe("ArtifactRow — open + workbookLastChild recording", () => {
  it("editable figure: double-click opens and shows the bound dataset name (single click selects — L0.25)", () => {
    const node = nodeOf("editable-figure", "editable-figure:fig1");
    render(<ArtifactRow node={node} depth={0} />);
    expect(screen.getByText("d1.dat")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /My Figure/ }));
    expect(useApp.getState().librarySelection).toEqual({ kind: "editable-figure", id: "fig1" });
    expect(useApp.getState().workbookLastChild).toEqual({}); // click did NOT open
    fireEvent.doubleClick(screen.getByRole("button", { name: /My Figure/ }));
    expect(useApp.getState().workbookLastChild.w1).toBe("editable-figure:fig1");
  });

  it("publication figure: shows its style as meta; double-click opens", () => {
    const node = nodeOf("publication-figure", "publication-figure:pub1");
    render(<ArtifactRow node={node} depth={0} />);
    expect(screen.getByText("line")).toBeInTheDocument();
    fireEvent.doubleClick(screen.getByRole("button", { name: /My Pub/ }));
    expect(useApp.getState().workbookLastChild.w1).toBe("publication-figure:pub1");
  });

  it("page: shows rows×cols as meta; double-click opens", () => {
    const node = nodeOf("page", "page:pg1");
    render(<ArtifactRow node={node} depth={0} />);
    expect(screen.getByText("2×3")).toBeInTheDocument();
    fireEvent.doubleClick(screen.getByRole("button", { name: /My Page/ }));
    // A page isn't nested under a workbook in this fixture (no source
    // dataset link), so nothing should be recorded.
    expect(useApp.getState().workbookLastChild).toEqual({});
  });

  it("report: shows the bound dataset name; double-click opens", () => {
    const node = nodeOf("report", "report:rep1");
    render(<ArtifactRow node={node} depth={0} />);
    expect(screen.getByText("d1.dat")).toBeInTheDocument();
    fireEvent.doubleClick(screen.getByRole("button", { name: /My Report/ }));
    expect(useApp.getState().openReportId).toBe("rep1");
    expect(useApp.getState().workbookLastChild.w1).toBe("report:rep1");
  });

  it("an unbound editable figure shows 'unbound'", () => {
    const node = nodeOf("editable-figure", "editable-figure:fig1", {
      workbooks: [], datasets: [],
      editableFigures: [createFigureDocument({ id: "fig1", name: "Loose", datasetId: null, view: defaultPlotView() })],
    });
    render(<ArtifactRow node={node} depth={0} />);
    expect(screen.getByText("unbound")).toBeInTheDocument();
  });
});
