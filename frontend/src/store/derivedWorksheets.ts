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
import { lit } from "../lib/macro";
import { recalcNodes, wouldCreateCycle } from "../lib/recalc";
import type { CorrectionParams, Dataset } from "../lib/types";
import { nextDatasetId, recompute, type AppState } from "./useApp";

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
 *  SOURCE's current raw/data — the K5c/K5d "real executor happy path".
 *  Called only from `recalcNow`; never synchronously from `touchDataset`. */
export async function recomputeDerivedSheet(get: SliceGet, sheet: Dataset): Promise<Dataset> {
  const sourceId = sheet.derivedFrom?.datasetId;
  const source = sourceId ? get().datasets.find((d) => d.id === sourceId) : undefined;
  if (!source) throw new Error(`source dataset "${sourceId}" no longer exists`);
  const raw = source.raw ?? source.data;
  const data = await applyCorrectionsApi({ dataset: raw, params: sheet.corrections ?? {} });
  return recompute({ ...sheet, data, raw });
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
        const raw = source.raw ?? source.data;
        const data = await applyCorrectionsApi({ dataset: raw, params });
        const newDs: Dataset = {
          id: newId,
          name: `${source.name} (derived)`,
          data,
          raw,
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
