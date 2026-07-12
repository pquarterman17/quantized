// Imported Origin graph snapshots + project-level fidelity manifests (#49).
// Composed into useApp so diagnostics stay outside scientific DataStruct
// metadata and the root store remains below its architecture size ratchet.

import {
  buildOriginFigureEntries,
  type OriginFigureEntry,
} from "../lib/originFigures";
import type { OriginFidelityEntry } from "../lib/originFidelity";
import type { OriginFidelityManifest, OriginFigure } from "../lib/types";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;

export interface OriginImportSlice {
  originFigures: OriginFigureEntry[];
  originFidelity: OriginFidelityEntry[];
  addOriginFigures: (stem: string, figures: OriginFigure[], datasetIds: string[]) => void;
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
  figures.map((f) => (f.datasetId && removedIds.has(f.datasetId) ? { ...f, datasetId: null } : f));

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
    addOriginFigures: (stem, figures, datasetIds) =>
      set((s) => {
        const candidates = s.datasets.filter((d) => datasetIds.includes(d.id));
        return {
          originFigures: [
            ...s.originFigures,
            ...buildOriginFigureEntries(stem, figures, candidates),
          ],
        };
      }),
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
