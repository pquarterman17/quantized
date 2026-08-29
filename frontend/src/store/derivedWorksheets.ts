// LIBRARY_WORKBOOK_UX_PLAN PR K, slice 2 (L0.50): derived worksheets +
// Freeze Copy — extracted into its own slice (the store/computedColumns.ts
// pattern) so useApp.ts only gains the extends-union + creator-spread lines.
//
// A DERIVED WORKSHEET is an ordinary Dataset with `derivedFrom` set (K2):
// `.corrections` IS its re-runnable pipeline recipe (the SAME CorrectionParams
// shape `applyCorrections` already uses — no new pipeline DSL invented), and
// `.raw` is a cache of its SOURCE's raw/data as of the last recompute (never
// hand-edited). `createDerivedWorksheet` runs the pipeline once against the
// CURRENT source and commits the result as a brand-new dataset in the same
// workbook — the source itself is never mutated (L0.13 non-destructive
// precedent). `recomputeDerivedSheet` (called ONLY from useApp.ts's
// `recalcNow` — the async stale-marked scheduler, K5c) re-runs the SAME
// pipeline against the source's LATEST raw/data; it is never called
// synchronously from `touchDataset`, keeping slice 1's invariant (c) intact:
// a source edit marks the sheet stale, nothing more, until an intentional
// recalc (auto-mode's debounce or "Recalculate Now") actually runs it.
//
// FREEZE COPY (L0.50) severs the link entirely: a plain, independent dataset
// carrying the derived sheet's CURRENT data, its own `.data.metadata` noting
// where it came from — no `derivedFrom`/`corrections`/`raw`, so it can never
// itself participate in the recalc graph.

import { cloneDataStruct } from "../lib/dataset";
import { applyCorrections as applyCorrectionsApi } from "../lib/api";
import { recomputeFromBase } from "../lib/formulaInputs";
import { lit } from "../lib/macro";
import { recalcNodes, wouldCreateCycle } from "../lib/recalc";
import type { CorrectionParams, Dataset } from "../lib/types";
import { nextDatasetId, type AppState } from "./useApp";

export interface DerivedWorksheetsSlice {
  /** Create a linked derived worksheet (L0.50) inside `sourceId`'s workbook:
   *  runs `params` against the source's CURRENT raw/data via the same
   *  corrections API regular corrections use, and commits the result as a
   *  new dataset with `derivedFrom` set. Refuses (zero mutation, via
   *  `setStatus`) when the source doesn't exist or the edge would create a
   *  cycle (K4). Returns the new dataset's id, or null on refusal/failure. */
  createDerivedWorksheet: (
    sourceId: string,
    params: CorrectionParams,
    pipelineLabel?: string,
  ) => Promise<string | null>;
  /** Freeze a derived worksheet's CURRENT data into a permanent, independent
   *  snapshot (L0.50) — a plain dataset with no `derivedFrom`/`corrections`/
   *  `raw`, provenance recorded in `data.metadata.frozenFrom`. Refuses when
   *  `id` isn't a derived worksheet. Returns the new dataset's id, or null. */
  freezeCopy: (id: string) => string | null;
}

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
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

/** Re-run a derived worksheet's pipeline (its own `.corrections`) against its
 *  SOURCE's current displayed table — the K5c/K5d "real executor happy
 *  path". Called only from `recalcNow`; never synchronously from
 *  `touchDataset`.
 *
 *  Review round P1-1: the base is `source.data`, NEVER `source.raw`.
 *  `.raw` means "MY OWN pristine pre-correction cache" — correct inside
 *  store/corrections.ts for in-place re-correction, WRONG for a cross-
 *  dataset source reference. L0.50's "source" is the source's CURRENT
 *  displayed table: reading `.raw` here silently discards the source's own
 *  correction pipeline, and for a chain (C derived from B, B itself
 *  derived from A) skips straight past B's entire pipeline to A's raw
 *  value — chains stop composing. A still-pending (lazy, preview-only)
 *  source fails closed rather than deriving from a downsampled preview;
 *  the caller (recalcNow) surfaces this and leaves the sheet stale.
 *
 *  SILENT_STATE_CORRUPTION_PLAN #4 (Class B): `corrected` below is the
 *  SOURCE's own table run through THIS sheet's pipeline — it has never had
 *  THIS sheet's `.formulas` appended, so it must go through the
 *  non-stripping `recomputeFromBase` (lib/formulaInputs.ts), never
 *  `recompute`/`recomputeWithErrors` (useApp.ts/formula.ts). Those STRIP
 *  the last `sheet.formulas.length` columns before reapplying — correct for
 *  a dataset's own `.data` (which already carries its own stale computed
 *  columns) but wrong here, where those trailing columns are REAL source
 *  columns (e.g. the source's own computed column) that were never the
 *  sheet's formulas at all. See derivedWorksheets.test.ts's #4 probe. */
export async function recomputeDerivedSheet(get: SliceGet, sheet: Dataset): Promise<Dataset> {
  const sourceId = sheet.derivedFrom?.datasetId;
  const source = sourceId ? get().datasets.find((d) => d.id === sourceId) : undefined;
  if (!source) throw new Error(`source dataset "${sourceId}" no longer exists`);
  if (source.pending) throw new Error(`source dataset "${source.name}" hasn't fully loaded yet`);
  const sourceData = source.data;
  const corrected = await applyCorrectionsApi({ dataset: sourceData, params: sheet.corrections ?? {} });
  // #50/#53 row-count-changed guard (excludedRows + the four overlays) is
  // applied by the CALLER (useApp.ts's recalcNow, via the shared
  // rowsChangedGuard — see store/corrections.ts) once it can see both the
  // old and new row counts and perform the actual `set()`; this function
  // stays a pure "compute the new Dataset" step, same shape as before.
  if (!sheet.formulas?.length) return { ...sheet, data: corrected, raw: sourceData, formulaErrors: undefined };
  const { data, errors } = recomputeFromBase(corrected, sheet.formulas);
  return { ...sheet, data, raw: sourceData, formulaErrors: Object.keys(errors).length ? errors : undefined };
}

// `set` unused here: both actions delegate to `get().addDataset(...)` (the
// single entry point, MAIN_PLAN #9) for the actual mutation + history entry
// — kept as a parameter for signature parity with every other
// createXSlice(set, get) in this codebase (corrections.ts, computedColumns.ts).
export function createDerivedWorksheetsSlice(_set: SliceSet, get: SliceGet): DerivedWorksheetsSlice {
  return {
    createDerivedWorksheet: async (sourceId, params, pipelineLabel) => {
      const source = get().datasets.find((d) => d.id === sourceId);
      if (!source) {
        get().setStatus("Can't create a derived worksheet: source dataset not found.");
        return null;
      }
      // P1-1 review fix: never derive from a still-pending (lazy, downsampled
      // preview) source — the user derives from what they SEE, and a preview
      // is not that.
      if (source.pending) {
        get().setStatus("Can't create a derived worksheet: source data hasn't fully loaded yet.");
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
        get().setStatus(`Can't create a derived worksheet: ${reason}`);
        return null;
      }
      try {
        // P1-1 review fix: the base is `source.data` (what the user SEES),
        // never `source.raw` — `.raw` means "the SOURCE's own pristine
        // pre-correction cache", which would silently discard the source's
        // own correction pipeline (or, for a chain, skip an intermediate
        // derived sheet's entire pipeline and jump straight to ITS source).
        const sourceData = source.data;
        const data = await applyCorrectionsApi({ dataset: sourceData, params });
        const newDs: Dataset = {
          id: newId,
          name: `${source.name} (derived)`,
          data,
          raw: sourceData,
          ...(Object.keys(params).length ? { corrections: params } : {}),
          derivedFrom: { datasetId: sourceId, pipeline: pipelineLabel?.trim() || summarizePipeline(params) },
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
        get().setStatus(`create derived worksheet failed: ${e instanceof Error ? e.message : "error"}`);
        return null;
      }
    },
    freezeCopy: (id) => {
      const src = get().datasets.find((d) => d.id === id);
      if (!src?.derivedFrom) {
        get().setStatus("Freeze Copy is only available for a derived worksheet.");
        return null;
      }
      const data = cloneDataStruct(src.data);
      data.metadata = {
        ...data.metadata,
        frozenFrom: {
          datasetId: src.id,
          datasetName: src.name,
          sourceId: src.derivedFrom.datasetId,
          pipeline: src.derivedFrom.pipeline,
          frozenAt: new Date().toISOString(),
        },
      };
      const frozen: Dataset = {
        id: nextDatasetId(),
        name: `${src.name} (frozen)`,
        data,
        ...(src.notes ? { notes: src.notes } : {}),
        ...(src.tags?.length ? { tags: [...src.tags] } : {}),
        ...(src.workbookId ? { workbookId: src.workbookId } : {}),
        ...(src.folderId ? { folderId: src.folderId } : {}),
      };
      get().addDataset(frozen); // single entry point (MAIN_PLAN #9) — one history entry
      get().recordMacro(`Freeze Copy of ${src.name}`, `qz.freezeCopy(${lit(src.name)})`, {
        kind: "expression",
        params: { id },
      });
      return frozen.id;
    },
  };
}
