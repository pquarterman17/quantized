// P4.2 / BUG-023: a frozen figure uses its own snapshot through screen,
// export, and a real workspace reopen, even when the live source has changed.
import { expect, it } from "vitest";

import { createFigureDocument, figureDocumentToPlotView } from "./figureDocument";
import { buildFigureSpecFromDocument, resolveFigureDocumentData } from "./figureSpec";
import { matrixData, matrixDataset, plainFigure } from "./regressionMatrixFixtures.testkit";
import { projectExport, projectScreen } from "./regressionMatrixLegs.testkit";
import { projectReopen, reopenProject } from "./regressionMatrixReopen.testkit";

it("keeps a frozen missing-data gap on screen, in export, and after workspace reopen", () => {
  const snapshot = matrixData();
  snapshot.values[2][0] = Number.NaN;
  snapshot.values[3][0] = -0;
  const live = matrixDataset();
  live.data.values[2][0] = 12345;
  live.data.values[3][0] = 67890;
  const figure = createFigureDocument({
    id: "frozen-gap",
    name: "frozen gap",
    datasetId: null,
    view: figureDocumentToPlotView(plainFigure()),
    data: { mode: "frozen", snapshot },
  });

  const reopened = reopenProject(figure, live);
  const exportBefore = buildFigureSpecFromDocument(figure, live, "frozen-gap");
  const exportAfter = buildFigureSpecFromDocument(reopened.figure, reopened.dataset, "frozen-gap");
  const reopenedData = resolveFigureDocumentData(reopened.figure, reopened.dataset).data;

  expect(projectExport(figure, live)).toEqual(projectScreen(figure, live));
  expect(projectReopen(reopened)).toEqual(projectScreen(figure, live));
  expect(projectExport(reopened.figure, reopened.dataset)).toEqual(projectScreen(figure, live));
  expect(exportBefore.dataset.values[2][0]).toBeNaN();
  expect(exportAfter.dataset.values[2][0]).toBeNaN();
  expect(reopenedData.values[2][0]).toBeNaN();
  expect(Object.is(exportAfter.dataset.values[3][0], -0)).toBe(true);
  expect(Object.is(reopenedData.values[3][0], -0)).toBe(true);
  expect(reopened.dataset.data.values[2][0]).toBe(12345);
  expect(exportAfter.y_keys).toEqual(exportBefore.y_keys);
});
