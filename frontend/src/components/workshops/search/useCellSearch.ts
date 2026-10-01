// Cell-text search for Find in project — the scheduling half of
// `lib/projectSearchCells.ts` (see its header for the index, the measurements,
// and why this is chunked main-thread work rather than a Worker).
//
// Under `SYNC_CELL_LIMIT` total text cells everything runs synchronously in a
// memo: building and querying that many cells is well under the ~50 ms a
// keystroke can afford, and tests see the answer on the first render. Above
// it, index builds and queries advance in `SLICE_MS` slices between
// `setTimeout` ticks, a newer query cancels the older one, and `searching`
// stays true until the answer is COMPLETE — partial counts are never shown.

import { useEffect, useMemo, useState } from "react";

import {
  cachedCellIndex,
  cellIndexFor,
  queryCellIndex,
  sidecarCellCount,
  startCellIndexBuild,
  startCellQuery,
  textColumnsSidecar,
  type CellMatch,
  type CellQuery,
  type TextColumnsSidecar,
} from "../../../lib/projectSearchCells";
import { rowsAreSampled } from "../../../lib/rowSidecars";
import type { Dataset } from "../../../lib/types";

/** ~250k cells builds in ~35 ms and queries in under 10 ms (measured scale:
 *  2M cells = 286 ms build, 3-57 ms query). */
export const SYNC_CELL_LIMIT = 250_000;
/** Main-thread time one slice may take before yielding to the next frame. */
export const SLICE_MS = 8;

export interface CellHit {
  id: string;
  datasetId: string;
  datasetName: string;
  column: string;
  count: number;
  /** Row index of the first matching cell (0-based). */
  firstRow: number;
  firstText: string;
  /** A still-sampled preview: its row numbers do not name real rows. */
  sampled: boolean;
}

interface Source {
  ds: Dataset;
  sidecar: TextColumnsSidecar;
}

function toHits(src: Source, matches: CellMatch[]): CellHit[] {
  return matches.map((m) => {
    const cells = src.sidecar[m.column] as unknown[];
    return {
      id: `cell:${src.ds.id}:${m.col}`,
      datasetId: src.ds.id,
      datasetName: src.ds.name,
      column: m.column,
      count: m.count,
      firstRow: m.firstRow,
      firstText: String(cells[m.firstRow]),
      sampled: rowsAreSampled(src.ds.pending),
    };
  });
}

interface Done {
  needle: string;
  sources: readonly Source[];
  hits: CellHit[];
}

export function useCellSearch(
  datasets: readonly Dataset[],
  query: string,
  opts: { syncCellLimit?: number; sliceMs?: number } = {},
): { hits: CellHit[]; searching: boolean } {
  const { syncCellLimit = SYNC_CELL_LIMIT, sliceMs = SLICE_MS } = opts;
  const needle = query.trim().toLowerCase();

  const sources = useMemo(
    () =>
      datasets.flatMap((ds): Source[] => {
        const sidecar = textColumnsSidecar(ds.data.metadata as Record<string, unknown> | undefined);
        return sidecar ? [{ ds, sidecar }] : [];
      }),
    [datasets],
  );
  const cells = useMemo(() => sources.reduce((n, s) => n + sidecarCellCount(s.sidecar), 0), [sources]);
  const sync = cells <= syncCellLimit;

  const syncHits = useMemo(
    () => (sync && needle ? sources.flatMap((s) => toHits(s, queryCellIndex(cellIndexFor(s.sidecar), needle))) : []),
    [sync, needle, sources],
  );

  const [done, setDone] = useState<Done | null>(null);
  useEffect(() => {
    if (sync || !needle) return;
    const hits: CellHit[] = [];
    let i = 0;
    let q: CellQuery | null = null;
    let timer: ReturnType<typeof setTimeout>;
    const run = () => {
      const t0 = performance.now();
      while (i < sources.length) {
        const left = () => Math.max(0, sliceMs - (performance.now() - t0));
        const src = sources[i];
        const index = cachedCellIndex(src.sidecar) ?? startCellIndexBuild(src.sidecar).step(left());
        if (index) {
          q ??= startCellQuery(index, needle);
          const matches = q.step(left());
          if (matches) {
            hits.push(...toHits(src, matches));
            i++;
            q = null;
          }
        }
        if (performance.now() - t0 >= sliceMs) break;
      }
      if (i < sources.length) timer = setTimeout(run, 0);
      else setDone({ needle, sources, hits });
    };
    timer = setTimeout(run, 0);
    return () => clearTimeout(timer);
  }, [sync, needle, sources, sliceMs]);

  if (!needle) return { hits: [], searching: false };
  if (sync) return { hits: syncHits, searching: false };
  const current = done !== null && done.needle === needle && done.sources === sources;
  return { hits: current ? done.hits : [], searching: !current };
}
