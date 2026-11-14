// N10: the Library's "Export PDF" for several saved (editable) figures -- one
// multi-page PDF, one page per figure in the order given, through the same
// batch route and spec builder the Batch figure builder uses. Lazy-loaded by
// the section that offers it.

import { downloadBatchFigures } from "../lib/batchFigureExport";
import { ghosterFor } from "../lib/excludedRowsExport";
import { useApp } from "./useApp";

/** Download the saved figures `ids` (in that order; ids that are not saved
 *  figures are skipped) as one PDF. Returns the page count. Throws, saying
 *  why, when nothing can be exported -- no partial file is ever written. */
export async function exportSavedFiguresPdf(ids: readonly string[], fileName = "figures"): Promise<number> {
  const state = useApp.getState();
  const byId = new Map(state.editableFigures.map((figure) => [figure.id, figure]));
  const figures = ids.flatMap((id) => {
    const figure = byId.get(id);
    return figure ? [figure] : [];
  });
  if (figures.length === 0) throw new Error("No saved figures to export.");
  await downloadBatchFigures(
    figures,
    state.datasets,
    {
      format: "pdf",
      multipage: true,
      archiveName: fileName,
      autoSeriesStyles: state.autoSeriesStyles,
      defaultTrace: state.defaultTrace,
      defaultLineWidth: state.defaultLineWidth,
      greyExcluded: ghosterFor(state.excludedDisplay),
    },
    undefined,
    (id) => useApp.getState().resolveDataset(id),
  );
  return figures.length;
}
