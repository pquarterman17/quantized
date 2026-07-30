// Tabulate workshop — state hook (v2, JMP_GAP_PLAN J6). Groups multiple value
// columns of the active dataset by up to 3 NESTED "by" columns (lib/tabulate's
// tabulateNested), computing a user-chosen stat set from the v2 catalog
// (STAT_KEYS). Reads the dataset's ANALYSIS view (lib/rowstate.analysisData)
// so excluded rows (#50) and the local filter (#53) drop from the summary —
// guard #11. Group-level numeric codes are resolved to their text category
// labels the same way plots do (lib/barlayout.resolveCategoryLabels), so
// TSV/report output never leaks ordinal codes. The table can be exported as a
// new library dataset (group columns + selected stat columns as numeric
// channels — the grand-total row, if any, is a preview/TSV/report-only
// convenience and is not part of that export) or emitted as a #36 report
// sheet (one record per row, group columns holding their resolved labels).

import { useMemo, useState } from "react";

import { reportEmit } from "../../../lib/api";
import { categoryLevels, resolveCategoryLabels } from "../../../lib/barlayout";
import { channelModelingType, isCategorical } from "../../../lib/modeling";
import { analysisData } from "../../../lib/rowstate";
import {
  STAT_KEYS,
  type StatKey,
  type TabRow,
  tabulateNested,
} from "../../../lib/tabulate";
import type { DataStruct } from "../../../lib/types";
import { toast } from "../../../store/toasts";
import { useActiveDataset, useApp } from "../../../store/useApp";

/** A selectable column: -1 is the x column, 0.. are channels. */
export interface TabulateColumn {
  index: number;
  label: string;
}

/** Up to this many nested group-by columns (JMP_GAP_PLAN J6 acceptance). */
export const MAX_GROUP_COLS = 3;

/** The stat keys checked by default — the legacy v1 six, so a fresh Tabulate
 *  open reads exactly like v1 did. */
const DEFAULT_STAT_KEYS: readonly StatKey[] = ["count", "mean", "sd", "min", "max", "median"];

export interface TabulateState {
  hasData: boolean;
  /** The active dataset's id, or null — feeds the ZoneWell drop-target guard
   *  so a channel dragged from a different dataset is rejected (v1
   *  single-dataset, mirrors Graph Builder's wells). */
  datasetId: string | null;
  columns: TabulateColumn[];
  /** Nested group-by columns, outermost first, 1..MAX_GROUP_COLS. */
  groupCols: number[];
  /** Value columns to summarize, 1..n. */
  valueCols: number[];
  /** Currently-checked stats, in STAT_KEYS catalog order. */
  statKeys: StatKey[];
  /** Append a grand-total row (every finite value, ignoring grouping). */
  grandTotal: boolean;
  setGrandTotal: (v: boolean) => void;
  addGroupCol: (i: number) => void;
  removeGroupCol: (i: number) => void;
  moveGroupCol: (i: number, direction: -1 | 1) => void;
  addValueCol: (i: number) => void;
  removeValueCol: (i: number) => void;
  moveValueCol: (i: number, direction: -1 | 1) => void;
  toggleStat: (k: StatKey) => void;
  rows: TabRow[];
  /** Channel names of the group-by columns (NOT their per-row level labels —
   *  see `levelLabel` for those). */
  groupLabels: string[];
  /** Channel names of the value columns. */
  valueLabels: string[];
  /** The resolved text label for `row`'s group level at nesting `depth`
   *  ("Total" at depth 0 / "" deeper for the grand-total row). */
  levelLabel: (row: TabRow, depth: number) => string;
  /** True when EVERY group-by column reads as categorical (few discrete
   *  levels). Any continuous column in the mix yields one row per observed
   *  numeric value — the panel warns. */
  groupIsCategorical: boolean;
  exportDataset: () => void;
  toTSV: () => string;
  /** True while the #36 report emission is in flight (disables the button). */
  reportBusy: boolean;
  /** Emit the on-screen table as a #36 stats_table report (one record per
   *  row, including the grand-total row when shown) into the Library Reports
   *  viewer. */
  toReport: () => Promise<void>;
}

const colValues = (data: DataStruct, index: number): number[] =>
  index < 0 ? data.time : data.values.map((row) => row[index]);

/** First channel that reads as categorical (nominal/ordinal), or null. */
function firstCategorical(active: ReturnType<typeof useActiveDataset>): number | null {
  if (!active) return null;
  for (let i = 0; i < active.data.labels.length; i++) {
    if (isCategorical(channelModelingType(active, i))) return i;
  }
  return null;
}

/** First continuous channel that isn't in `avoid`, or the first free channel,
 *  or 0. */
function firstContinuous(active: ReturnType<typeof useActiveDataset>, avoid: readonly number[]): number {
  if (!active) return 0;
  const n = active.data.labels.length;
  const skip = new Set(avoid);
  for (let i = 0; i < n; i++) {
    if (!skip.has(i) && !isCategorical(channelModelingType(active, i))) return i;
  }
  for (let i = 0; i < n; i++) if (!skip.has(i)) return i;
  return 0;
}

function moveInArray<T>(arr: readonly T[], item: T, direction: -1 | 1): T[] {
  const i = arr.indexOf(item);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= arr.length) return [...arr];
  const next = [...arr];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

let _seq = 0;

export function useTabulate(): TabulateState {
  const active = useActiveDataset();
  const addDataset = useApp((s) => s.addDataset);
  const addReport = useApp((s) => s.addReport);
  const setStatus = useApp((s) => s.setStatus);
  const [reportBusy, setReportBusy] = useState(false);

  // Analysis view: excluded/filtered rows pruned so the summary matches the
  // worksheet's (guard #11 — read rows only through lib/rowstate).
  const data = useMemo(() => analysisData(active), [active]);

  const columns = useMemo<TabulateColumn[]>(() => {
    if (!active) return [];
    const xName = String(active.data.metadata?.["x_column_name"] ?? "x");
    return [
      { index: -1, label: xName },
      ...active.data.labels.map((lab, i) => ({ index: i, label: lab })),
    ];
  }, [active]);

  // Defaults mirror v1: group by the first categorical channel (else the
  // first channel); value = the first continuous channel that isn't grouped.
  const [groupCols, setGroupCols] = useState<number[]>(() => [firstCategorical(active) ?? 0]);
  const [valueCols, setValueCols] = useState<number[]>(() => [
    firstContinuous(active, [firstCategorical(active) ?? 0]),
  ]);
  const [statKeys, setStatKeys] = useState<StatKey[]>(() => [...DEFAULT_STAT_KEYS]);
  const [grandTotal, setGrandTotal] = useState(false);

  const rows = useMemo(() => {
    if (!data || groupCols.length === 0 || valueCols.length === 0) return [];
    return tabulateNested(
      groupCols.map((c) => colValues(data, c)),
      valueCols.map((c) => colValues(data, c)),
      { grandTotal },
    );
  }, [data, groupCols, valueCols, grandTotal]);

  // Text-label resolution per group column (lib/barlayout — the same
  // metadata-text-column-then-numeric-fallback rule plots use), memoized per
  // (data, groupCols) so a level lookup is O(1) per row/depth.
  const labelMaps = useMemo(() => {
    if (!data) return [];
    return groupCols.map((c) => {
      const levels = categoryLevels(data, c);
      const labels = resolveCategoryLabels(data, c, levels);
      const m = new Map<number, string>();
      levels.forEach((lvl, i) => m.set(lvl, labels[i]));
      return m;
    });
  }, [data, groupCols]);

  const labelOf = (i: number) => columns.find((c) => c.index === i)?.label ?? (i < 0 ? "x" : `col ${i}`);
  const groupLabels = groupCols.map(labelOf);
  const valueLabels = valueCols.map(labelOf);
  const groupIsCategorical =
    !!active && groupCols.every((c) => c >= 0 && isCategorical(channelModelingType(active, c)));

  function levelLabel(row: TabRow, depth: number): string {
    if (row.isTotal) return depth === 0 ? "Total" : "";
    const lvl = row.levels[depth];
    return labelMaps[depth]?.get(lvl) ?? String(lvl);
  }

  function headerLabels(): string[] {
    return [...groupLabels, ...valueLabels.flatMap((vl) => statKeys.map((k) => `${vl} ${k}`))];
  }

  function rowCells(row: TabRow): (string | number)[] {
    const groupCells = groupCols.map((_, d) => levelLabel(row, d));
    const statCells = valueCols.flatMap((_, vi) => statKeys.map((k) => row.values[vi][k]));
    return [...groupCells, ...statCells];
  }

  // #38 deferred edge: `rows` is derived from the possibly-preview `active`
  // dataset — self-corrects on the next render once the fetch lands, but a
  // click BEFORE that would silently export/report the incomplete summary.
  // Abort (kick the fetch, ask the user to retry) rather than proceed.
  function pendingGuard(action: string): boolean {
    if (!active?.pending) return false;
    useApp.getState().ensureBookData(active.id);
    setStatus(`still loading full data — try ${action} again in a moment`);
    return true;
  }

  function exportDataset(): void {
    if (!rows.length) return;
    if (pendingGuard("Export")) return;
    const dataRows = rows.filter((r) => !r.isTotal);
    if (!dataRows.length) {
      setStatus("nothing to export (only the grand-total row is present)");
      return;
    }
    const groupChannels = groupCols.map((_, d) => dataRows.map((r) => r.levels[d]));
    const statChannels: number[][] = [];
    const statLabels: string[] = [];
    valueCols.forEach((vc, vi) => {
      statKeys.forEach((k) => {
        statChannels.push(dataRows.map((r) => r.values[vi][k]));
        statLabels.push(`${labelOf(vc)} ${k}`);
      });
    });
    const allChannels = [...groupChannels, ...statChannels];
    const out: DataStruct = {
      time: dataRows.map((_, i) => i),
      values: dataRows.map((_, i) => allChannels.map((ch) => ch[i])),
      labels: [...groupLabels, ...statLabels],
      units: allChannels.map(() => ""),
      metadata: { x_column_name: "row", source: "tabulate" },
    };
    const name = `${valueLabels.join(", ")} by ${groupLabels.join(" × ")}`;
    addDataset({ id: `tab-${++_seq}`, name, data: out });
    setStatus(`tabulated ${name} (${dataRows.length} rows)`);
  }

  function toTSV(): string {
    const header = headerLabels().join("\t");
    const body = rows.map((r) => rowCells(r).join("\t"));
    return [header, ...body].join("\n");
  }

  // Functional (prev-based) setState throughout this block — several
  // callers (ZoneWell's click-to-assign + drag, and test code exercising
  // more than one mutation per tick) can fire two of these in the same React
  // batch; reading the outer `groupCols`/`valueCols` closures instead would
  // let the second call clobber the first's effect instead of composing.
  // The cap/duplicate TOAST is the one exception — it's informational only,
  // so a same-tick staleness there is harmless and keeps the message call
  // out of the (possibly double-invoked under StrictMode) updater.

  function addGroupCol(i: number): void {
    if (groupCols.length >= MAX_GROUP_COLS && !groupCols.includes(i)) {
      toast(`Tabulate nests up to ${MAX_GROUP_COLS} group columns`, "info");
    }
    setGroupCols((prev) => (prev.includes(i) || prev.length >= MAX_GROUP_COLS ? prev : [...prev, i]));
  }

  function removeGroupCol(i: number): void {
    setGroupCols((prev) => {
      const next = prev.filter((c) => c !== i);
      return next.length ? next : [firstCategorical(active) ?? 0];
    });
  }

  function moveGroupCol(i: number, direction: -1 | 1): void {
    setGroupCols((prev) => moveInArray(prev, i, direction));
  }

  function addValueCol(i: number): void {
    setValueCols((prev) => (prev.includes(i) ? prev : [...prev, i]));
  }

  function removeValueCol(i: number): void {
    setValueCols((prev) => {
      const next = prev.filter((c) => c !== i);
      return next.length ? next : [firstContinuous(active, groupCols)];
    });
  }

  function moveValueCol(i: number, direction: -1 | 1): void {
    setValueCols((prev) => moveInArray(prev, i, direction));
  }

  function toggleStat(k: StatKey): void {
    setStatKeys((prev) => {
      const set = new Set(prev);
      if (set.has(k)) set.delete(k);
      else set.add(k);
      return STAT_KEYS.filter((key) => set.has(key));
    });
  }

  async function toReport(): Promise<void> {
    if (!rows.length || !active) return;
    if (pendingGuard("report")) return;
    setReportBusy(true);
    try {
      const headers = headerLabels();
      const records = rows.map((r) => {
        const cells = rowCells(r);
        const rec: Record<string, unknown> = {};
        headers.forEach((h, i) => {
          rec[h] = cells[i];
        });
        return rec;
      });
      const title = `${valueLabels.join(", ")} by ${groupLabels.join(" × ")} — ${active.name}`;
      const { report } = await reportEmit({
        kind: "stats_table",
        records,
        title,
        source_refs: [{ kind: "dataset", id: active.id, name: active.name }],
      });
      addReport(title, report, active.id);
      setStatus(`emitted ${title} (${rows.length} rows)`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "report failed", "danger");
    } finally {
      setReportBusy(false);
    }
  }

  return {
    hasData: !!active,
    datasetId: active?.id ?? null,
    columns,
    groupCols,
    valueCols,
    statKeys,
    grandTotal,
    setGrandTotal,
    addGroupCol,
    removeGroupCol,
    moveGroupCol,
    addValueCol,
    removeValueCol,
    moveValueCol,
    toggleStat,
    rows,
    groupLabels,
    valueLabels,
    levelLabel,
    groupIsCategorical,
    exportDataset,
    toTSV,
    reportBusy,
    toReport,
  };
}
