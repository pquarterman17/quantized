// Acceptance pass 15 U6: a snapshot result's Library row says "Out of date" once its source data changed, as the
// result window does. Before, only a persisted `stale` flag showed on the row.

import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { AnalysisResult } from "../../lib/analysisResult";
import { analysisDataFingerprint } from "../../lib/analysisResultFreshness";
import { buildLibraryHierarchy } from "../../lib/libraryHierarchy";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import ArtifactRow from "./ArtifactRows";

const sheet = (values: number[]): Dataset => ({
  id: "d1", name: "sv.csv", workbookId: "w1",
  data: { time: values.map((_, i) => i), values: values.map((v) => [v]), labels: ["val"], units: [""], metadata: {} },
});
const saved = sheet([1, 2, 3, 4]);
const result: AnalysisResult = {
  version: 1, id: "r1", name: "One-way", producer: { id: "fit-y-by-x", label: "Fit Y by X", version: 1 },
  sources: [{ datasetId: "d1", role: "input" }], outputs: [], warnings: [], createdAt: "now",
  sourceFingerprint: analysisDataFingerprint(saved),
};
const row = () => {
  const node = buildLibraryHierarchy({
    folders: [], workbooks: [{ id: "w1", name: "W" }], datasets: [saved], editableFigures: [], publicationFigures: [],
    pages: [], reports: [], analysisResults: [result],
  }).byKey.get("analysis-result:r1");
  if (!node || node.kind !== "analysis-result") throw new Error("fixture missing");
  return <ArtifactRow node={node} depth={0} />;
};

beforeEach(() => {
  useApp.setState({ workbooks: [{ id: "w1", name: "W" }], datasets: [saved], analysisResults: [result], folders: [] });
});

describe("Library row of a snapshot result", () => {
  it("is plain while the source is unchanged, and says Out of date after a source edit", async () => {
    render(row());
    await waitFor(() => expect(screen.getByText("Fit Y by X")).toBeInTheDocument());
    expect(screen.queryByText(/Out of date/)).toBeNull();
    act(() => useApp.setState({ datasets: [sheet([1, 2, 3, 5])] }));
    expect(await screen.findByText("Fit Y by X · Out of date")).toBeInTheDocument();
    act(() => useApp.setState({ datasets: [sheet([1, 2, 3, 4])] })); // edited back: current again
    await waitFor(() => expect(screen.queryByText(/Out of date/)).toBeNull());
  });
});
