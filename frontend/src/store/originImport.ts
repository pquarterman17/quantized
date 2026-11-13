// Imported Origin graph snapshots + project-level fidelity manifests (#49).
// Composed into useApp so diagnostics stay outside scientific DataStruct
// metadata and the root store remains below its architecture size ratchet.

import type { OriginFigureEntry } from "../lib/originFigures";
import type { OriginFidelityEntry } from "../lib/originFidelity";
import type { OriginFidelityManifest } from "../lib/types";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;

export interface OriginImportSlice {
  originFigures: OriginFigureEntry[];
  originFidelity: OriginFidelityEntry[];
  /** Append one import's figure entries, already matched to its datasets by
   *  `lib/originFigureEntries.buildOriginFigureEntries` (lazy import path). */
  addOriginFigures: (entries: OriginFigureEntry[]) => void;
  addOriginFidelity: (
    stem: string,
    manifest: OriginFidelityManifest,
    siblingIds: string[],
  ) => void;
}

export const pruneOriginFigureRefs = (
  figures: OriginFigureEntry[],
  removedIds: ReadonlySet<string>,
): OriginFigureEntry[] =>
  figures.map((f) => {
    const datasetId = f.datasetId && removedIds.has(f.datasetId) ? null : f.datasetId;
    const mappings = Object.entries(f.sourceOverrides ?? {}).filter(
      ([, targetId]) => !removedIds.has(targetId),
    );
    if (datasetId === f.datasetId && mappings.length === Object.keys(f.sourceOverrides ?? {}).length) {
      return f;
    }
    return {
      ...f,
      datasetId,
      sourceOverrides: mappings.length > 0 ? Object.fromEntries(mappings) : undefined,
    };
  });

export function pruneOriginFidelityRefs(
  entries: OriginFidelityEntry[],
  removed: ReadonlySet<string>,
): OriginFidelityEntry[] {
  return entries.flatMap((entry) => {
    const siblingIds = entry.siblingIds.filter((id) => !removed.has(id));
    return siblingIds.length > 0 ? [{ ...entry, siblingIds }] : [];
  });
}

export function createOriginImportSlice(set: SliceSet): OriginImportSlice {
  return {
    originFigures: [],
    originFidelity: [],
    addOriginFigures: (entries) => set((s) => ({ originFigures: [...s.originFigures, ...entries] })),
    addOriginFidelity: (stem, manifest, siblingIds) =>
      set((s) => ({
        originFidelity: [
          ...s.originFidelity,
          {
            id: `origin-fidelity-${siblingIds[0] ?? stem}-${s.originFidelity.length}`,
            stem,
            siblingIds,
            manifest,
          },
        ],
      })),
  };
}
