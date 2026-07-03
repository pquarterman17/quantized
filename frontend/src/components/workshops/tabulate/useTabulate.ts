// Tabulate workshop — state hook. Groups a value column of the active dataset by
// the distinct levels of a "by" column and shows per-group descriptive stats
// (lib/tabulate). Reads the dataset's ANALYSIS view (lib/rowstate.analysisData)
// so excluded rows (#50) drop from the summary. The table can be exported as a
// new library dataset (group key → x, aggregates → channels).

import { useMemo, useState } from "react";

import { channelModelingType, isCategorical } from "../../../lib/modeling";
import { analysisData } from "../../../lib/rowstate";
import { AGG_KEYS, type GroupSummaryRow, tabulate } from "../../../lib/tabulate";
import type { DataStruct } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";

/** A selectable column: -1 is the x column, 0.. are channels. */
export interface TabulateColumn {
  index: number;
  label: string;
}

export interface TabulateState {
  hasData: boolean;
  columns: TabulateColumn[];
  groupCol: number;
  valueCol: number;
  setGroupCol: (i: number) => void;
  setValueCol: (i: number) => void;
  rows: GroupSummaryRow[];
  groupLabel: string;
  valueLabel: string;
  /** True when the by-column reads as categorical (few discrete levels). A
   *  continuous by-column yields one row per value — the panel warns. */
  groupIsCategorical: boolean;
  exportDataset: () => void;
  toTSV: () => string;
}

let _seq = 0;

const colValues = (data: DataStruct, index: number): number[] =>
  index < 0 ? data.time : data.values.map((row) => row[index]);

export function useTabulate(): TabulateState {
  const active = useActiveDataset();
  const addDataset = useApp((s) => s.addDataset);
  const setStatus = useApp((s) => s.setStatus);

  // Analysis view: excluded rows pruned so the summary matches the worksheet's.
  const data = useMemo(() => analysisData(active), [active]);

  const columns = useMemo<TabulateColumn[]>(() => {
    if (!active) return [];
    const xName = String(active.data.metadata?.["x_column_name"] ?? "x");
    return [
      { index: -1, label: xName },
      ...active.data.labels.map((lab, i) => ({ index: i, label: lab })),
    ];
  }, [active]);

  // Default group-by to the first categorical channel (else the first channel);
  // value to the first continuous channel that isn't the group column.
  const [groupCol, setGroupCol] = useState<number>(() => firstCategorical(active) ?? 0);
  const [valueCol, setValueCol] = useState<number>(() => firstContinuous(active, firstCategorical(active) ?? 0));

  const rows = useMemo(() => {
    if (!data) return [];
    return tabulate(colValues(data, groupCol), colValues(data, valueCol));
  }, [data, groupCol, valueCol]);

  const labelOf = (i: number) => columns.find((c) => c.index === i)?.label ?? (i < 0 ? "x" : `col ${i}`);
  const groupLabel = labelOf(groupCol);
  const valueLabel = labelOf(valueCol);
  const groupIsCategorical = !!active && groupCol >= 0 && isCategorical(channelModelingType(active, groupCol));

  function exportDataset(): void {
    if (!rows.length) return;
    const data: DataStruct = {
      time: rows.map((r) => r.group),
      values: rows.map((r) => [r.count, r.mean, r.sd, r.min, r.max, r.median]),
      labels: AGG_KEYS.map((k) => `${valueLabel} ${k}`),
      units: AGG_KEYS.map(() => ""),
      metadata: { x_column_name: groupLabel, source: "tabulate" },
    };
    addDataset({ id: `tab-${++_seq}`, name: `${valueLabel} by ${groupLabel}`, data });
    setStatus(`tabulated ${valueLabel} by ${groupLabel} (${rows.length} groups)`);
  }

  function toTSV(): string {
    const header = [groupLabel, ...AGG_KEYS].join("\t");
    const body = rows.map((r) =>
      [r.group, r.count, r.mean, r.sd, r.min, r.max, r.median].join("\t"),
    );
    return [header, ...body].join("\n");
  }

  return {
    hasData: !!active,
    columns,
    groupCol,
    valueCol,
    setGroupCol,
    setValueCol,
    rows,
    groupLabel,
    valueLabel,
    groupIsCategorical,
    exportDataset,
    toTSV,
  };
}

/** First channel that reads as categorical (nominal/ordinal), or null. */
function firstCategorical(active: ReturnType<typeof useActiveDataset>): number | null {
  if (!active) return null;
  for (let i = 0; i < active.data.labels.length; i++) {
    if (isCategorical(channelModelingType(active, i))) return i;
  }
  return null;
}

/** First continuous channel that isn't `avoid`, or the first channel, or 0. */
function firstContinuous(active: ReturnType<typeof useActiveDataset>, avoid: number): number {
  if (!active) return 0;
  const n = active.data.labels.length;
  for (let i = 0; i < n; i++) {
    if (i !== avoid && !isCategorical(channelModelingType(active, i))) return i;
  }
  for (let i = 0; i < n; i++) if (i !== avoid) return i;
  return 0;
}
