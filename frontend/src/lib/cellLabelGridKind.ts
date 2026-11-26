// Which grid a map's "Cell values" labels describe, for the Inspector's note:
// the MEASURED cells (the scan is a lattice, lib/cellLabelsNative.ts) or the
// DISPLAY grid (it is not). The Map stage knows (it reads the rows); the
// Inspector is a separate tree, so the stage publishes it here per dataset.
// Transient: never saved, never part of the figure.

import { useSyncExternalStore } from "react";

export type CellGridKind = "measured" | "display";

const kinds = new Map<string, CellGridKind>();
const listeners = new Set<() => void>();

export function publishCellGridKind(id: string, kind: CellGridKind | null): void {
  if (kind === null ? !kinds.delete(id) : kinds.get(id) === kind) return;
  if (kind) kinds.set(id, kind);
  listeners.forEach((f) => f());
}

const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => void listeners.delete(f);
};

export function useCellGridKind(id: string | null | undefined): CellGridKind | undefined {
  return useSyncExternalStore(subscribe, () => (id ? kinds.get(id) : undefined));
}

/** The Inspector note for `kind`. */
export const cellGridNote = (kind: CellGridKind): string =>
  kind === "measured" ? "Labels describe the measured cells." : "Labels describe the display grid: the rows are not a regular scan.";
