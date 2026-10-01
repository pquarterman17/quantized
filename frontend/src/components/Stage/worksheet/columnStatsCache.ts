// Per-column cache for the worksheet stats footer (1M x 6 audit). The footer
// used to re-send every column to /api/stats/descriptive on any change — 7M
// values for one edited cell. This gives each column a content VERSION and
// keys a result by (column version, analysis-rows version), so only a column
// whose values, or whose rows, actually changed is requested again.
//
// Versions come from diffing against the last data seen, cheaply: the grid is
// row-major and an edit replaces only the rows it touches, so unchanged rows
// are skipped by reference and only replaced rows are compared cell by cell.

import type { CalcResult, DataStruct } from "../../../lib/types";

function sameNumbers(a: ArrayLike<unknown>, b: ArrayLike<unknown>): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

/** Channels (0-based) whose values differ between two grids. */
function changedChannels(prev: DataStruct["values"], next: DataStruct["values"], channels: number): Set<number> {
  const changed = new Set<number>();
  if (prev === next) return changed;
  if (prev.length !== next.length) {
    for (let c = 0; c < channels; c++) changed.add(c);
    return changed;
  }
  for (let r = 0; r < next.length && changed.size < channels; r++) {
    const a = prev[r];
    const b = next[r];
    if (a === b) continue;
    for (let c = 0; c < channels; c++) if (!Object.is(a?.[c], b?.[c])) changed.add(c);
  }
  return changed;
}

/** Slot 0 is the x/time column; slot c + 1 is channel c. */
export class ColumnStatsCache {
  private data: DataStruct | null = null;
  private rows: readonly number[] | null = null;
  private versions: number[] = [];
  private rowsVersion = 0;
  private nextVersion = 1;
  private results = new Map<string, CalcResult>();

  /** One key per slot for `data` over `rows`. A slot's key changes only when
   *  that column's values or the rows change. Drops results for older keys. */
  keys(data: DataStruct, rows: readonly number[]): string[] {
    if (this.rows === null || !sameNumbers(this.rows, rows)) this.rowsVersion = this.nextVersion++;
    this.rows = rows;
    const channels = data.labels.length;
    const prev = this.data;
    const versions = this.versions.slice(0, channels + 1);
    const timeChanged = !prev || !sameNumbers(prev.time, data.time);
    const changed = prev ? changedChannels(prev.values, data.values, channels) : new Set<number>();
    for (let s = 0; s <= channels; s++) {
      const stale = s === 0 ? timeChanged : !prev || changed.has(s - 1);
      if (stale || versions[s] === undefined) versions[s] = this.nextVersion++;
    }
    this.data = data;
    this.versions = versions;
    const keys = versions.map((v) => `${v}:${this.rowsVersion}`);
    const keep = new Set(keys);
    for (const k of this.results.keys()) if (!keep.has(k)) this.results.delete(k);
    return keys;
  }

  get(key: string): CalcResult | undefined {
    return this.results.get(key);
  }

  set(key: string, result: CalcResult): void {
    this.results.set(key, result);
  }
}
