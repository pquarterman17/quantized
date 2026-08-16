import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildArtifactMenu, deleteArtifactConfirmed, type ArtifactNode } from "./artifactContextActions";
import { askConfirm } from "../overlays/ConfirmDialog";
import type { ContextMenuItem } from "../overlays/ContextMenu";
import { buildLibraryHierarchy } from "../../lib/libraryHierarchy";
import { createPageDocument } from "../../lib/pageDocument";
import { useApp } from "../../store/useApp";

vi.mock("../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

type ActionItem = Extract<ContextMenuItem, { run: () => void }>;
const action = (items: ContextMenuItem[], label: string): ActionItem =>
  items.find((item): item is ActionItem => "label" in item && item.label === label && "run" in item)!;

beforeEach(() => {
  useApp.setState({ pages: [], reports: [], editableFigures: [], figureDocs: [], history: [] });
  vi.mocked(askConfirm).mockReset();
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

  it("editable-figure deletion names the page panels that will lose their figure", async () => {
    vi.mocked(askConfirm).mockResolvedValue(true as never);
    const page = createPageDocument({ id: "p1", name: "Summary", rows: 1, cols: 2 });
    const referencing = { ...page, panels: page.panels.map((panel, i) => (i === 0 ? { ...panel, figureId: "fig1" } : panel)) };
    useApp.setState({
      pages: [referencing],
      editableFigures: [{ id: "fig1", name: "Moment sweep" } as never],
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
