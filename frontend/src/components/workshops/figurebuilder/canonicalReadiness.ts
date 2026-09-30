// Canonical draft readiness — extracted out of useFigureBuilder.ts (F2.3c) to
// fund that hook's shapes wiring: it sat at its exact TS_MODULE_PINS ceiling
// (616) with zero headroom before this slice added anything. Same "pay for
// new wiring by extracting first" move F3.1 used on useApp.ts
// (appendWorkspace -> store/workspaceIO.ts) when it was at ITS pin. Pure --
// no React/store import, unit-testable standalone, same shape as
// canonicalOverrides.ts/canonicalSeries.ts.
//
// F4.2c (a): the preview spec draws the live dataset's excluded and
// filter-dropped rows the way the app-wide "Excluded rows" mode does (grey
// companions, or left out), the same rule `legacyFigure.buildLegacyPreviewSpec`
// applies -- so what the preview shows is what the Export's pre-selected
// answer produces. It used to omit them unconditionally, so a "greyed"
// export (the default) carried companions the preview never showed.

import type { FigureSpec } from "../../../lib/api/figures";
import { ghosterFor } from "../../../lib/excludedRowsExport";
import type { FigureDocument } from "../../../lib/figureDocument";
import { buildFigureSpecFromDocument, resolveFigureDocumentData } from "../../../lib/figureSpec";
import type { DataStruct, Dataset } from "../../../lib/types";
import type { ExcludedDisplay } from "../../../store/useApp";

export type CanonicalReadiness =
  | { state: "ready"; data: DataStruct; spec: FigureSpec }
  | { state: "missing-source"; error: string }
  | { state: "invalid-spec"; data: DataStruct; error: string };

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "unknown error";

/** The last wire dataset built per live dataset. A pruned or greyed dataset
 *  is a NEW object on every build, and the preview's dataset-handle cache
 *  (`lib/api/datasetCache.ts`) is keyed on that object, so without this every
 *  title keystroke would re-upload the whole dataset. Reused only while the
 *  same live dataset (whose identity carries its row state), the same data
 *  and the same mode + channel picks produced it -- the inputs the masked
 *  build reads. Mirrors `legacyFigure.stableWireDataset`. */
const lastWire = new WeakMap<Dataset, { data: DataStruct; key: string; dataset: DataStruct }>();

function stableWireDataset(spec: FigureSpec, live: Dataset, data: DataStruct, key: string): FigureSpec {
  if (spec.dataset === data) return spec; // nothing dropped: already the stable object
  const hit = lastWire.get(live);
  if (hit && hit.data === data && hit.key === key) return { ...spec, dataset: hit.dataset };
  lastWire.set(live, { data, key, dataset: spec.dataset });
  return spec;
}

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
 *  through the generic catch below unchanged.
 *
 *  `excludedDisplay` is the app-wide "Excluded rows" mode the preview follows
 *  (see the module header); absent, masked rows are omitted. */
export function computeCanonicalReadiness(
  document: FigureDocument | null,
  dataset: Dataset | null,
  autoSeriesStyles = false,
  excludedDisplay?: ExcludedDisplay,
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
    // P3.3: `autoSeriesStyles` is true for a session whose TARGET window
    // cycles per `windowCyclesSeriesStyles` — focused or not — see
    // `canonicalSession`'s `selectSessionCyclesSeriesStyles`, which is the
    // caller's source for it. The preview must show the dashes that
    // window's Stage export will emit.
    const mode = excludedDisplay ?? "hide";
    const built = buildFigureSpecFromDocument(document, dataset, "preview", {
      autoSeriesStyles,
      greyExcluded: ghosterFor(mode),
    });
    // A frozen document renders its own snapshot and never prunes, so only a
    // live one has a masked wire dataset worth keeping stable.
    const spec = dataset && document.data.mode !== "frozen"
      ? stableWireDataset(built, dataset, data, `${mode}|${String(built.x_key)}|${String(built.y_keys)}`)
      : built;
    return { state: "ready", data, spec };
  } catch (error) {
    return {
      state: "invalid-spec",
      data,
      error: `figure configuration is not previewable: ${errorMessage(error)}`,
    };
  }
}
