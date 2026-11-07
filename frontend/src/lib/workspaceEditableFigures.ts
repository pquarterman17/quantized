// The `.dwk` `editableFigures` reader, moved verbatim out of lib/workspace.ts
// (its only caller, `parseWorkspace`) under that file's 500-line ceiling, to
// fund MAIN_PLAN #42's `savedSampleProfiles` field without packing or
// deleting any of its comments. Lazy: reachable only from the `.dwk` codec.

import {
  FIGURE_DOCUMENT_VERSION,
  figureDocumentVersion,
  sanitizeFigureDocument,
  type FigureDocument,
} from "./figureDocument";

/** Future editable schemas are skipped; malformed v1 and duplicate ids are dropped. */
export function parseEditableFigures(value: unknown, datasetIds: ReadonlySet<string>, migrationWarnings: string[]): FigureDocument[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const documents: FigureDocument[] = [];
  for (const candidate of value) {
    const version = figureDocumentVersion(candidate);
    if (version !== null && version > FIGURE_DOCUMENT_VERSION) {
      const candidateId =
        typeof candidate === "object" && candidate !== null
          ? (candidate as Record<string, unknown>).id
          : undefined;
      const id = typeof candidateId === "string" ? ` "${candidateId}"` : "";
      migrationWarnings.push(`skipped saved FigureDocument${id} with unsupported version ${version}`);
      continue;
    }
    const document = sanitizeFigureDocument(candidate);
    if (!document || seen.has(document.id)) continue;
    seen.add(document.id);
    documents.push(
      document.bindings.datasetId && !datasetIds.has(document.bindings.datasetId)
        ? { ...document, bindings: { ...document.bindings, datasetId: null } }
        : document,
    );
  }
  return documents;
}
