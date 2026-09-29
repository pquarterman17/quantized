// Reflectivity fit — "Send to figure page" (P2.2): store the fit's figure
// template (reflFitFigure.ts) as editable figures plus a saved Figure Page, as
// ONE undo step, and open that page in the Figure Page workshop. The caller
// first makes sure the fit-curve datasets exist ("Add fit curves") and passes
// their ids. Names are deduplicated like every other new figure, so sending
// the same fit twice makes a second page, never overwrites the first.
//
// Store access is by selector plus `useApp.setState` — no imperative store
// snapshot reads (architecture.test.ts's getState file-count ratchet).

import { dedupeWindowTitle } from "../../../lib/plotview";
import { nextFigureId } from "../../../store/figureLifecycle";
import { nextDatasetId, useApp } from "../../../store/useApp";
import { reflFitFigurePage, type FigureSources } from "./reflFitFigure";

export function useReflFitFigure(): (src: FigureSources) => void {
  const recordHistory = useApp((s) => s.recordHistory);
  const openPageDocument = useApp((s) => s.openPageDocument);
  const setStatus = useApp((s) => s.setStatus);
  const figureNames = useApp((s) => s.editableFigures).map((f) => f.name);
  const pageNames = useApp((s) => s.pages).map((p) => p.name);

  return (src) => {
    const { figures, page } = reflFitFigurePage(src, {
      figure: nextFigureId,
      page: nextDatasetId().replace(/^ds-/, "page-"),
      now: new Date().toISOString(),
    });
    const taken = [...figureNames];
    for (const f of figures) {
      f.name = dedupeWindowTitle(f.name, taken);
      taken.push(f.name);
    }
    page.name = dedupeWindowTitle(page.name, pageNames);
    recordHistory("reflectivity fit figure");
    useApp.setState((s) => ({ editableFigures: [...s.editableFigures, ...figures], pages: [...s.pages, page] }));
    openPageDocument(page.id);
    setStatus(`made figure page "${page.name}" with ${figures.length} linked figures`);
  };
}
