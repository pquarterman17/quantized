import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildArtifactMenu, type ArtifactNode } from "./artifactContextActions";
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
