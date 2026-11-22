// The Figure Builder preview's async seam for a saved DISPLAY fit (a large Curve
// Fit): the sync document builder leaves such a fit out, so the preview waits
// for the full curve (`lib/figureSavedFit.withFullSavedFit`, the same step a
// Figure Page panel and the Export take) and renders the upgraded document.
// Until it lands the preview draws WITHOUT the fit and says so (`note`); when
// the fetch fails the document stays unchanged (fail closed: the fit stays left
// out, exactly as the sync builder does) and the note says that instead.
import { useEffect, useState } from "react";

import type { FigureDocument } from "../../../lib/figureDocument";
import { hasSavedDisplayFit, withFullSavedFit } from "../../../lib/figureSavedFit";
import type { Dataset } from "../../../lib/types";

interface Upgraded {
  source: FigureDocument;
  dataset: Dataset | null;
  staleFits: readonly string[] | undefined;
  doc: FigureDocument;
}

export function useFullSavedFitDocument(
  document: FigureDocument | null,
  dataset: Dataset | null,
  staleFits: readonly string[] | undefined,
): { doc: FigureDocument | null; note: string | null } {
  const [done, setDone] = useState<Upgraded | null>(null);
  const needs = document !== null && hasSavedDisplayFit(document);
  useEffect(() => {
    if (!document || !needs) return;
    let live = true;
    void withFullSavedFit(document, dataset, staleFits).then((upgraded) => {
      if (live) setDone({ source: document, dataset, staleFits, doc: upgraded });
    });
    return () => {
      live = false;
    };
  }, [document, dataset, staleFits, needs]);
  if (!document || !needs) return { doc: document, note: null };
  if (done && done.source === document && done.dataset === dataset && done.staleFits === staleFits) {
    // Unchanged after the fetch = it could not be upgraded (or it is stale): left out, with the builder's notice.
    return done.doc === document
      ? { doc: document, note: "Saved fit left out of the preview: its full curve could not be loaded (the export reports the same)." }
      : { doc: done.doc, note: null };
  }
  return { doc: document, note: "Saved fit not drawn yet: loading its full curve." };
}
