// The lazy-only half of figureDocument.ts (bundle diet, plans/BUNDLE_HEADROOM.md slice 34):
// the JSON wire form of a figure document. No production module calls it today; the tests do.
// The code moved here verbatim and figureDocument.ts re-exports it with `export *` -
// importers and tests are unchanged, and Rollup bundles this file with the
// lazy chunks that use it. architecture.test.ts ("re-exported lazy half")
// keeps eager modules off it.

import { sanitizeFigureDocument, type FigureDocument } from "./figureDocument";
import { encodePersistedCells } from "./nonFiniteCells";

export function serializeFigureDocument(document: FigureDocument): string {
  return JSON.stringify(document, encodePersistedCells);
}

export function deserializeFigureDocument(raw: string): FigureDocument | null {
  try {
    return sanitizeFigureDocument(JSON.parse(raw));
  } catch {
    return null;
  }
}
