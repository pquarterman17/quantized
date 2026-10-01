// The worksheet stats footer: per-column descriptive stats (golden
// /api/stats/descriptive) over the ANALYSIS rows — independent of the windowed
// display range and the sort order, so stats follow filter + mask but not
// scroll/ordering. Split out of useWorksheetView.ts.
//
// Only columns whose values or rows changed are requested (./columnStatsCache):
// a one-cell edit at 1M x 6 sent all 7M values before, and now sends 1M.

import { useEffect, useRef, useState } from "react";

import { statsDescriptive } from "../../../lib/api/statsDescriptive";
import type { CalcResult, DataStruct } from "../../../lib/types";
import { ColumnStatsCache } from "./columnStatsCache";

// Finite values only, like the Distribution workshop: a blank (NaN) cell
// serializes as null, which the route rejects (422).
const finite = (xs: (number | undefined)[]) => xs.filter((v): v is number => Number.isFinite(v));

export function useWorksheetStats(data: DataStruct, rows: readonly number[], show: boolean) {
  const [colStats, setColStats] = useState<(CalcResult | null)[] | null>(null);
  const [statsErr, setStatsErr] = useState(false);
  const cache = useRef<ColumnStatsCache | null>(null);

  useEffect(() => {
    if (!show) {
      setColStats(null);
      setStatsErr(false);
      return;
    }
    let cancelled = false;
    setColStats(null);
    setStatsErr(false);
    // Debounced so a burst of edits costs one round of requests, not one per edit.
    const timer = setTimeout(() => {
      const stats = (cache.current ??= new ColumnStatsCache());
      const { time, values } = data;
      const column = (slot: number) => finite(rows.map((r) => (slot === 0 ? time[r] : values[r]?.[slot - 1])));
      const keys = stats.keys(data, rows);
      // A request still lands in the cache if this round is superseded: its
      // key names the exact column content it was computed from.
      const results = keys.map((key, slot) => {
        const hit = stats.get(key);
        return hit ? Promise.resolve(hit) : statsDescriptive(column(slot)).then((res) => (stats.set(key, res), res));
      });
      Promise.all(results)
        .then((res) => {
          if (!cancelled) setColStats(res);
        })
        .catch(() => {
          if (!cancelled) setStatsErr(true);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [data, rows, show]);

  return { colStats, statsErr };
}
