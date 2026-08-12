// Canonical draft readiness — extracted out of useFigureBuilder.ts (F2.3c) to
// fund that hook's shapes wiring: it sat at its exact TS_MODULE_PINS ceiling
// (616) with zero headroom before this slice added anything. Same "pay for
// new wiring by extracting first" move F3.1 used on useApp.ts
// (appendWorkspace -> store/workspaceIO.ts) when it was at ITS pin. Pure --
// no React/store import, unit-testable standalone, same shape as
// canonicalOverrides.ts/canonicalSeries.ts.

import type { FigureSpec } from "../../../lib/api";
import type { FigureDocument } from "../../../lib/figureDocument";
import { buildFigureSpecFromDocument, resolveFigureDocumentData } from "../../../lib/figureSpec";
import type { DataStruct, Dataset } from "../../../lib/types";

export type CanonicalReadiness =
  | { state: "ready"; data: DataStruct; spec: FigureSpec }
  | { state: "missing-source"; error: string }
  | { state: "invalid-spec"; data: DataStruct; error: string };

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "unknown error";

/** Resolve `document`'s renderable data + preview spec, or the specific
 *  reason it can't render yet. Null only when there is no document at all
 *  (legacy mode) -- callers keep that case out of the union so `null` always
 *  means "not canonical" rather than a fourth readiness state.
 *
 *  A live document whose bound dataset isn't in the store (closed, never
 *  loaded this session) is caught here with an actionable message before it
 *  reaches `resolveFigureDocumentData`, which would otherwise surface the raw
 *  internal dataset id in the user-facing message. Other failures (a frozen
 *  document with no snapshot, a dataset/document id mismatch) still flow
 *  through the generic catch below unchanged. */
export function computeCanonicalReadiness(
  document: FigureDocument | null,
  dataset: Dataset | null,
): CanonicalReadiness | null {
  if (!document) return null;
  if (document.data.mode !== "frozen" && document.bindings.datasetId !== null && !dataset) {
    return {
      state: "missing-source",
      error: "source unavailable: this figure's dataset is not loaded — re-import it to preview or export",
    };
  }
  let data: DataStruct;
  try {
    data = resolveFigureDocumentData(document, dataset).data;
  } catch (error) {
    return { state: "missing-source", error: `source unavailable: ${errorMessage(error)}` };
  }
  try {
    return { state: "ready", data, spec: buildFigureSpecFromDocument(document, dataset, "preview") };
  } catch (error) {
    return {
      state: "invalid-spec",
      data,
      error: `figure configuration is not previewable: ${errorMessage(error)}`,
    };
  }
}
