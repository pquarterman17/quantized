import { describe, expect, it } from "vitest";

import { createFigureDocument } from "./figureDocument";
import { generateFigureThumbnail } from "./thumbnailArtifacts";
import { buildLibraryHierarchy } from "./libraryHierarchy";
import { defaultPlotView } from "./plotview";
import { resolveThumbnailRequest } from "./thumbnailRequest";
import type { Dataset } from "./types";

const dataset = {
  id: "d1", name: "Sweep", path: null, tags: [], notes: "", workbookId: null,
  data: {
    time: [0, 1, 2], values: [[0, 2], [1, 5], [2, 3]],
    labels: ["x", "signal"], units: ["s", "V"], metadata: {},
  },
} as unknown as Dataset;

describe("figure thumbnail generator — E-c2", () => {
  it("renders canonical figure data as a compact SVG plot", async () => {
    const figure = createFigureDocument({
      id: "f1", name: "Sweep plot", datasetId: "d1",
      view: { ...defaultPlotView(), xKey: 0, yKeys: [1] },
    });
    const hierarchy = buildLibraryHierarchy({ folders: [], workbooks: [], datasets: [dataset], editableFigures: [figure] });
    const node = hierarchy.byKey.get("editable-figure:f1")!;
    const request = resolveThumbnailRequest(node, { datasets: [dataset], editableFigures: [figure] });

    const result = await generateFigureThumbnail(request, new AbortController().signal);
    const svg = decodeURIComponent(result.url.replace("data:image/svg+xml,", ""));

    expect(svg).toContain("<polyline");
    expect(svg).toContain("#6d5bd0");
    expect(svg).not.toContain("No plottable data");
  });
});
