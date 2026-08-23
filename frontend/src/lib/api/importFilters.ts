// /api/import/{guess,preview,parse,filters} wrappers — split out of
// lib/api.ts (R8 bundle-diet pass, 2026-08-23; see api/reference.ts's
// header for why): every consumer is the lazy import wizard workshop. NOT
// re-exported by lib/api.ts; useImportWizard.ts / lib/importwizard.ts
// import directly from this path.
//
// `importParse` posts to the SAME `/api/import/parse` endpoint as
// lib/api.ts's own `parseImportText` (pre-existing duplication, carried
// over verbatim — not this pass's concern).

import { deleteJSON, getJSON, postJSON } from "./http";
import type { DataStruct, ImportFilterWire, ImportPreviewResponse, ImportSettingsWire } from "../types";

/** Best-effort starting `ImportSettings` for a file's raw text. */
export function importGuess(text: string): Promise<ImportSettingsWire> {
  return postJSON("/api/import/guess", { text });
}

/** Parse the first rows under `settings` (or auto-guess if `null`) for the
 *  wizard's live preview table. */
export function importPreview(
  text: string,
  settings: ImportSettingsWire | null,
  maxRows = 30,
): Promise<ImportPreviewResponse> {
  return postJSON("/api/import/preview", { text, settings, max_rows: maxRows });
}

/** Import the full text under confirmed settings into a DataStruct. */
export function importParse(
  text: string,
  settings: ImportSettingsWire,
): Promise<DataStruct> {
  return postJSON("/api/import/parse", { text, settings });
}

/** All saved import filters (name + glob + settings), most-recent last. */
export function listImportFilters(): Promise<ImportFilterWire[]> {
  return getJSON("/api/import/filters");
}

/** Save (upsert by name) a filter binding a glob to import settings. */
export function saveImportFilter(
  name: string,
  glob: string,
  settings: ImportSettingsWire,
): Promise<ImportFilterWire> {
  return postJSON("/api/import/filters", { name, glob, settings });
}

/** Delete a saved filter by name. */
export function deleteImportFilter(name: string): Promise<{ deleted: string }> {
  return deleteJSON(`/api/import/filters/${encodeURIComponent(name)}`);
}
