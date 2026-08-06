// Persisted multi-panel Figure Page library (FIGURE_AUTHORING_WORKFLOW_PLAN
// F3.1) — the versioned PageDocument collection round-tripped through .dwk
// (lib/workspace.ts) and autosave, mirroring editableFigures
// (store/figureLifecycle.ts)'s slice shape. Save/Save As/rename/duplicate/
// delete lifecycle actions are F3.3, not this slice: it only owns the
// persisted collection itself so the schema has a real home to round-trip
// through before that UI lands.
import type { PageDocument } from "../lib/pageDocument";

export interface PageDocumentSlice {
  pages: PageDocument[];
}

export function createPageDocumentsSlice(): PageDocumentSlice {
  return { pages: [] };
}
