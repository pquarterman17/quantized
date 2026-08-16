// Red-first coverage for the PR #149 Sol-review blocking finding: a
// thumbnail's cache identity must include every preview-relevant
// dependency revision, not only the primary entity's — a page preview is
// stale when a referenced figure changes even though the PAGE object
// didn't, and a live figure's preview is stale when its source dataset is
// replaced even though the FIGURE object didn't.

import { describe, expect, it } from "vitest";

import type { LibraryNode } from "./libraryHierarchy";
import { resolveThumbnailRequest, type ThumbnailSnapshot } from "./thumbnailRequest";

const source = (datasetIds: string[] = [], missing: string[] = []) => ({
  datasetIds,
  missingDatasetIds: missing,
  usedPlacementFallback: false,
});

const pageNode = (entity: object, datasetIds: string[] = []): LibraryNode =>
  ({ key: "page:p1", entityId: "p1", kind: "page", name: "P", parentKey: null, depth: 0, children: [],
     entity, source: source(datasetIds) } as unknown as LibraryNode);

const figureNode = (entity: object, datasetIds: string[]): LibraryNode =>
  ({ key: "editable-figure:f1", entityId: "f1", kind: "editable-figure", name: "F", parentKey: null,
     depth: 0, children: [], entity, source: source(datasetIds) } as unknown as LibraryNode);

const snap = (over: Partial<ThumbnailSnapshot>): ThumbnailSnapshot => ({
  datasets: [],
  editableFigures: [],
  ...over,
});

describe("resolveThumbnailRequest — dependency-aware fingerprints (E-c1 round 2)", () => {
  it("editing a figure referenced by an UNCHANGED page changes the page's fingerprint", () => {
    const page = { id: "p1", panels: [{ figureId: "f1" }] };
    const figureV1 = { id: "f1", bindings: {} };
    const before = resolveThumbnailRequest(pageNode(page), snap({ editableFigures: [figureV1 as never] }));
    const figureV2 = { id: "f1", bindings: {} }; // store mutation replaced the object
    const after = resolveThumbnailRequest(pageNode(page), snap({ editableFigures: [figureV2 as never] }));
    expect(after.fingerprint).not.toBe(before.fingerprint);
  });

  it("replacing the source dataset of an UNCHANGED live figure changes its fingerprint", () => {
    const figure = { id: "f1", bindings: { datasetId: "d1" } };
    const datasetV1 = { id: "d1" };
    const before = resolveThumbnailRequest(
      figureNode(figure, ["d1"]),
      snap({ datasets: [datasetV1 as never] }),
    );
    const datasetV2 = { id: "d1" }; // reimport/pending-load replaced the object
    const after = resolveThumbnailRequest(
      figureNode(figure, ["d1"]),
      snap({ datasets: [datasetV2 as never] }),
    );
    expect(after.fingerprint).not.toBe(before.fingerprint);
  });

  it("an unchanged entity AND unchanged deps keep a stable fingerprint across resolves", () => {
    const page = { id: "p1", panels: [{ figureId: "f1" }] };
    const figure = { id: "f1", bindings: {} };
    const s = snap({ editableFigures: [figure as never] });
    expect(resolveThumbnailRequest(pageNode(page), s).fingerprint).toBe(
      resolveThumbnailRequest(pageNode(page), s).fingerprint,
    );
  });

  it("a page panel whose figure is MISSING is a stable sentinel, distinct from the figure being present", () => {
    const page = { id: "p1", panels: [{ figureId: "f1" }] };
    const withMissing = resolveThumbnailRequest(pageNode(page), snap({}));
    const withMissingAgain = resolveThumbnailRequest(pageNode(page), snap({}));
    const withFigure = resolveThumbnailRequest(pageNode(page), snap({ editableFigures: [{ id: "f1", bindings: {} } as never] }));
    expect(withMissing.fingerprint).toBe(withMissingAgain.fingerprint);
    expect(withFigure.fingerprint).not.toBe(withMissing.fingerprint);
  });

  it("an empty-string figureId is one (missing) reference for BOTH resolver and generator — the deps cursor cannot desync", async () => {
    const { generatePageThumbnail } = await import("./thumbnailPage");
    const page = { id: "p1", rows: 1, cols: 2, panels: [{ figureId: "" }, { figureId: "f1" }] };
    const figure = { id: "f1", bindings: {} };
    const request = resolveThumbnailRequest(pageNode(page), snap({ editableFigures: [figure as never] }));
    expect(request.deps).toEqual([null, figure]); // "" = missing reference sentinel, in panel order
    const svg = decodeURIComponent(
      (await generatePageThumbnail(request, new AbortController().signal)).url,
    );
    expect(svg.match(/fill-opacity="0\.55"/g)).toHaveLength(1); // exactly the f1 panel filled
  });

  it("the generator receives the SAME resolved dependency objects the fingerprint was formed from", () => {
    const page = { id: "p1", panels: [{ figureId: "f1" }] };
    const figure = { id: "f1", bindings: { datasetId: "d1" } };
    const dataset = { id: "d1" };
    const request = resolveThumbnailRequest(
      pageNode(page, ["d1"]),
      snap({ editableFigures: [figure as never], datasets: [dataset as never] }),
    );
    expect(request.deps).toContain(figure);
    expect(request.deps).toContain(dataset);
    expect(request.node.entity).toBe(page);
  });
});
