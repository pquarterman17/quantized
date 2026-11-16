// The body of `createDerivedWorksheet` (store/derivedWorksheets.ts), moved
// verbatim behind a dynamic `import()` (bundle diet slice 30,
// plans/BUNDLE_HEADROOM.md). It runs only from the "Create derived worksheet"
// gesture, which is already async (it awaits the corrections API), so the
// pipeline call and the dataset it builds stay out of the startup chunk.

import { applyCorrections as applyCorrectionsApi } from "../lib/api";
import { lit } from "../lib/macro";
import { recalcNodes, wouldCreateCycle } from "../lib/recalc";
import type { CorrectionParams, Dataset } from "../lib/types";
import { nextDatasetId } from "./idSeq";
import type { AppState } from "./useApp";

type SliceGet = () => AppState;

/** A short human-readable pipeline descriptor (K2's `derivedFrom.pipeline`)
 *  when the caller doesn't supply one — just the set params, comma-joined,
 *  so the Library/worksheet badges have something legible to show. */
function summarizePipeline(params: CorrectionParams): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== false && v !== "")
    .map(([k, v]) => (v === true ? k : `${k}=${Array.isArray(v) ? `[${v.length}]` : String(v)}`));
  return parts.length ? `Corrections: ${parts.join(", ")}` : "Corrections (no params)";
}

export async function createDerivedWorksheetRun(
  get: SliceGet,
  sourceId: string,
  params: CorrectionParams,
  pipelineLabel?: string,
): Promise<string | null> {
  const source = get().datasets.find((d) => d.id === sourceId);
  if (!source) {
    get().setStatus("Can't create a derived worksheet: source dataset not found.", "danger");
    return null;
  }
  // P1-1 review fix: never derive from a still-pending (lazy, downsampled
  // preview) source — the user derives from what they SEE, and a preview
  // is not that.
  if (source.pending) {
    get().setStatus("Can't create a derived worksheet: source data hasn't fully loaded yet.", "danger");
    return null;
  }
  const newId = nextDatasetId();
  // K4: write-time cycle rejection, wired through the same pure check
  // every other edge-creating write uses — see lib/recalc.ts's header.
  const reason = wouldCreateCycle(get().datasets, {
    from: recalcNodes.dataset(sourceId),
    to: recalcNodes.dataset(newId),
  });
  if (reason) {
    get().setStatus(`Can't create a derived worksheet: ${reason}`, "danger");
    return null;
  }
  try {
    // P1-1 review fix: the base is `source.data` (what the user SEES),
    // never `source.raw` — `.raw` means "the SOURCE's own pristine
    // pre-correction cache", which would silently discard the source's
    // own correction pipeline (or, for a chain, skip an intermediate
    // derived sheet's entire pipeline and jump straight to ITS source).
    const sourceData = source.data;
    const data = await applyCorrectionsApi({
      dataset: sourceData,
      params,
      ...(source.errorRoles ? { error_bindings: source.errorRoles } : {}),
    });
    const newDs: Dataset = {
      id: newId,
      name: `${source.name} (derived)`,
      data,
      raw: sourceData,
      ...(Object.keys(params).length ? { corrections: params } : {}),
      derivedFrom: { datasetId: sourceId, pipeline: pipelineLabel?.trim() || summarizePipeline(params) },
      ...(source.errorRoles ? { errorRoles: [...source.errorRoles] } : {}),
      ...(source.workbookId ? { workbookId: source.workbookId } : {}),
      ...(source.folderId ? { folderId: source.folderId } : {}),
    };
    get().addDataset(newDs); // single entry point (MAIN_PLAN #9) — its own one recordHistory
    get().recordMacro(
      `Create derived worksheet from ${source.name}`,
      `qz.createDerivedWorksheet(${lit(source.name)}, ${lit(params)})`,
      { kind: "expression", params: { sourceId, params } },
    );
    return newDs.id;
  } catch (e) {
    get().setStatus(`create derived worksheet failed: ${e instanceof Error ? e.message : "error"}`, "danger");
    return null;
  }
}
