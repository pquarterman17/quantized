import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildArtifactMenu, deleteArtifactConfirmed, type ArtifactNode } from "./artifactContextActions";
import { askConfirm } from "../overlays/ConfirmDialog";
import type { ContextMenuItem } from "../overlays/ContextMenu";
import { createFigureDocument } from "../../lib/figureDocument";
import { buildLibraryHierarchy } from "../../lib/libraryHierarchy";
import { createPageDocument } from "../../lib/pageDocumentActions";
import { defaultPlotView } from "../../lib/plotview";
import { useApp } from "../../store/useApp";

vi.mock("../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));
const { runSendEditableFigureToReport } = vi.hoisted(() => ({ runSendEditableFigureToReport: vi.fn() }));
vi.mock("../../lib/sendFigureToReport", () => ({ runSendEditableFigureToReport }));

type ActionItem = Extract<ContextMenuItem, { run: () => void }>;
const action = (items: ContextMenuItem[], label: string): ActionItem =>
  items.find((item): item is ActionItem => "label" in item && item.label === label && "run" in item)!;

beforeEach(() => {
  useApp.setState({ pages: [], reports: [], analysisResults: [], openAnalysisResultId: null, editableFigures: [], figureDocs: [], history: [], status: "" });
  vi.mocked(askConfirm).mockReset();
  runSendEditableFigureToReport.mockReset();
});

describe("artifact lifecycle context actions — PR E-b2", () => {
  it("duplicates a page through its canonical store action", () => {
    const page = createPageDocument({ id: "p1", name: "Panel", rows: 1, cols: 1 });
    useApp.setState({ pages: [page] });
    const hierarchy = buildLibraryHierarchy({ folders: [], workbooks: [], datasets: [], pages: [page] });
    const node = hierarchy.byKey.get("page:p1") as Extract<ArtifactNode, { kind: "page" }>;

    action(buildArtifactMenu(node), "Duplicate").run();

    expect(useApp.getState().pages.map((item) => item.name)).toEqual(["Panel", "Panel copy"]);
  });

  it("keeps report duplication visible with a short disabled reason", () => {
    const report = { id: "r1", name: "Fit", datasetId: null, report: { title: "Fit", sections: [] } };
    const hierarchy = buildLibraryHierarchy({ folders: [], workbooks: [], datasets: [], reports: [report] });
    const node = hierarchy.byKey.get("report:r1") as Extract<ArtifactNode, { kind: "report" }>;

    const duplicate = action(buildArtifactMenu(node), "Duplicate");
    expect(duplicate.disabled).toBe(true);
    expect(duplicate.title).toBe("report duplication is not available yet");
  });

  it("keeps result duplication explicit and deletes only the catalog record with an undo warning", async () => {
    vi.mocked(askConfirm).mockResolvedValue(true as never);
    const result = {
      version: 1 as const, id: "a1", name: "Smooth result",
      producer: { id: "signal-processing", label: "Signal Processing", version: 1 },
      sources: [], outputs: [], warnings: [], createdAt: "now",
    };
    useApp.setState({ analysisResults: [result], openAnalysisResultId: "a1" });
    const hierarchy = buildLibraryHierarchy({ folders: [], workbooks: [], datasets: [], analysisResults: [result] });
    const node = hierarchy.byKey.get("analysis-result:a1") as Extract<ArtifactNode, { kind: "analysis-result" }>;
    expect(action(buildArtifactMenu(node), "Duplicate").title).toBe("use Rerun as New from the result workspace");

    action(buildArtifactMenu(node), "Delete").run();
    expect(askConfirm).toHaveBeenCalledWith(
      'Delete "Smooth result"?',
      expect.stringMatching(/linked worksheets.*Undo can restore/),
      "Delete",
      true,
    );
    await Promise.resolve();
    expect(useApp.getState().analysisResults).toEqual([]);
    expect(useApp.getState().openAnalysisResultId).toBeNull();
  });

  it("editable-figure deletion names the page panels that will lose their figure", async () => {
    vi.mocked(askConfirm).mockResolvedValue(true as never);
    const page = createPageDocument({ id: "p1", name: "Summary", rows: 1, cols: 2 });
    const referencing = { ...page, panels: page.panels.map((panel, i) => (i === 0 ? { ...panel, figureId: "fig1" } : panel)) };
    useApp.setState({
      pages: [referencing],
      // A real document: the trash path sizes `data` on delete (#292), so an
      // under-shaped fixture would fail inside the store, not in the assertion.
      editableFigures: [createFigureDocument({ id: "fig1", name: "Moment sweep", datasetId: null, view: defaultPlotView() })],
    });
    const node = {
      key: "editable-figure:fig1", entityId: "fig1", kind: "editable-figure", name: "Moment sweep",
      parentKey: null, depth: 0, children: [],
      source: { datasetIds: [], missingDatasetIds: [], usedPlacementFallback: false },
      entity: { id: "fig1", name: "Moment sweep" },
    } as unknown as Extract<ArtifactNode, { kind: "editable-figure" }>;

    action(buildArtifactMenu(node), "Delete").run();

    expect(askConfirm).toHaveBeenCalledWith(
      'Delete "Moment sweep"?',
      expect.stringMatching(/Used by "Summary" \(panel .+\); those panels will show as missing\./),
      "Delete",
      true,
    );
    await Promise.resolve(); // the confirmed run resolves through the mock
    expect(useApp.getState().editableFigures).toHaveLength(0);
  });

  it("Delete on the keyboard routes through deleteArtifactConfirmed — fail-closed for Origin figures", () => {
    const originNode = {
      key: "origin-figure:o1", entityId: "o1", kind: "origin-figure", name: "Graph1",
      parentKey: null, depth: 0, children: [],
      source: { datasetIds: [], missingDatasetIds: [], usedPlacementFallback: false },
      entity: { id: "o1", datasetId: null },
    } as unknown as ArtifactNode;
    deleteArtifactConfirmed(originNode);
    // A disabled registry action must never confirm-then-no-op from the key.
    expect(askConfirm).not.toHaveBeenCalled();
  });

  it("fails closed for lifecycle edits on recovered Origin figures", () => {
    const node = {
      key: "origin-figure:o1", entityId: "o1", kind: "origin-figure", name: "Graph1",
      parentKey: null, depth: 0, children: [],
      source: { datasetIds: [], missingDatasetIds: ["missing"], usedPlacementFallback: false },
      entity: { id: "o1", datasetId: null },
    } as unknown as Extract<ArtifactNode, { kind: "origin-figure" }>;
    const items = buildArtifactMenu(node);

    expect(action(items, "Open").disabled).toBe(true);
    expect(action(items, "Rename…").disabled).toBe(true);
    expect(action(items, "Duplicate").disabled).toBe(true);
    expect(action(items, "Delete").disabled).toBe(true);
    expect(action(items, "Delete").title).toBe("recovered Origin figures are managed by their source import");
  });
});

describe("artifact.addToReport — ported from PR #454", () => {
  const editableNode = {
    key: "editable-figure:fig1", entityId: "fig1", kind: "editable-figure", name: "Moment sweep",
    parentKey: null, depth: 0, children: [],
    source: { datasetIds: [], missingDatasetIds: [], usedPlacementFallback: false },
    entity: { id: "fig1", name: "Moment sweep" },
  } as unknown as Extract<ArtifactNode, { kind: "editable-figure" }>;

  it("is available only for canonical editable figures", () => {
    expect(action(buildArtifactMenu(editableNode), "Add to Report…")).toBeDefined();

    const report = {
      ...editableNode, key: "report:r1", entityId: "r1", kind: "report", name: "Report",
      entity: { id: "r1", name: "Report" },
    } as unknown as Extract<ArtifactNode, { kind: "report" }>;
    expect(buildArtifactMenu(report).some((i) => "label" in i && i.label === "Add to Report…")).toBe(false);
  });

  it("loads lib/sendFigureToReport lazily (runLazy) and runs it against the clicked figure's id", async () => {
    // Wait on STATE the mock itself writes, not on the mock call directly
    // (architecture.test.ts's weak-wait ratchet) — the dynamic `import()`
    // resolves across a real module-load tick, not just a microtask.
    runSendEditableFigureToReport.mockClear().mockImplementation(async (getState: typeof useApp.getState, id: string) => {
      getState().setStatus(`ran for ${id}`);
    });
    action(buildArtifactMenu(editableNode), "Add to Report…").run();
    await vi.waitFor(() => expect(useApp.getState().status).toBe("ran for fig1"));
    expect(runSendEditableFigureToReport).toHaveBeenCalledWith(useApp.getState, "fig1");
  });
});

describe("artifact.saveAsTemplate — PR H5c honest disabled stub", () => {
  it("appears disabled on an editable-figure node, pointing at the builder", () => {
    const node = {
      key: "editable-figure:fig1", entityId: "fig1", kind: "editable-figure", name: "Moment sweep",
      parentKey: null, depth: 0, children: [],
      source: { datasetIds: [], missingDatasetIds: [], usedPlacementFallback: false },
      entity: { id: "fig1", name: "Moment sweep" },
    } as unknown as Extract<ArtifactNode, { kind: "editable-figure" }>;

    const item = action(buildArtifactMenu(node), "Save as Template…");
    expect(item.disabled).toBe(true);
    expect(item.title).toBe("save a Quick Plot template from the Quick Figure Builder instead");
  });

  it("is absent entirely (not merely disabled) on a non-editable-figure artifact", () => {
    const node = {
      key: "origin-figure:o1", entityId: "o1", kind: "origin-figure", name: "Graph1",
      parentKey: null, depth: 0, children: [],
      source: { datasetIds: [], missingDatasetIds: [], usedPlacementFallback: false },
      entity: { id: "o1", datasetId: null },
    } as unknown as ArtifactNode;
    const items = buildArtifactMenu(node);
    expect(items.some((i) => "label" in i && i.label === "Save as Template…")).toBe(false);
  });
});
