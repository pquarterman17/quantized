// Curve Fit — Global fit, pure helpers (no React, no store). Which series a
// global fit can run on, the (x, y) each one sends, the sharing constraints the
// route takes, how a fitted curve maps back onto its dataset's rows (the fit
// overlay), and the result/report tables.
//
// A MEMBER is one fitted series: a dataset plus its X/Y channels. Two sources:
//   * channels — several Y channels of the active dataset against its plotted X;
//   * datasets — the active dataset's plotted X/primary-Y columns, found BY
//     LABEL in each other dataset (a run series from one instrument). A dataset
//     lacking either column is listed as missing, never silently rebound to
//     another column (the fail-closed rule the Origin bindings follow).

import { dropGapRows, restoreGapRows, type FinitePairs } from "../../../lib/api/finitePairs";
import type { GlobalFitResult } from "../../../lib/api/globalFit";
import { activeRowIndices, analysisData, droppedRows, expandToFull } from "../../../lib/rowstate";
import type { Dataset } from "../../../lib/types";

export type GlobalSource = "channels" | "datasets";

export interface GlobalMember {
  datasetId: string;
  xKey: number | null;
  yKey: number;
  label: string;
}

export const memberKey = (m: Pick<GlobalMember, "datasetId" | "yKey">): string => `${m.datasetId}:${m.yKey}`;

/** Every value channel of `ds` except the plotted X and role-tagged columns. */
export function channelMembers(ds: Dataset, xKey: number | null): GlobalMember[] {
  return ds.data.labels
    .map((label, yKey) => ({ datasetId: ds.id, xKey, yKey, label }))
    .filter((m) => m.yKey !== xKey && !ds.channelRoles?.[m.yKey]);
}

/** The active dataset's X/primary-Y columns, matched by label in each dataset. */
export function datasetMembers(
  datasets: readonly Dataset[],
  active: Dataset,
  xKey: number | null,
  yKey: number,
): { members: GlobalMember[]; missing: string[] } {
  const xLabel = xKey == null ? null : active.data.labels[xKey];
  const yLabel = active.data.labels[yKey];
  const members: GlobalMember[] = [];
  const missing: string[] = [];
  for (const ds of datasets) {
    const own = ds.id === active.id;
    const yi = own ? yKey : ds.data.labels.indexOf(yLabel ?? "");
    const xi = own || xLabel == null ? xKey : ds.data.labels.indexOf(xLabel);
    if (yi < 0 || (xi != null && xi < 0)) missing.push(ds.name);
    else members.push({ datasetId: ds.id, xKey: xi, yKey: yi, label: ds.name });
  }
  return { members, missing };
}

export interface MemberData {
  x: number[];
  y: number[];
  pairs: FinitePairs;
}

/** The member's analysis rows (exclusions/filters applied), gap rows dropped. */
export function memberData(ds: Dataset, m: GlobalMember): MemberData | null {
  const data = analysisData(ds);
  if (!data) return null;
  const x = m.xKey == null ? data.time : data.values.map((row) => row[m.xKey!]);
  const y = data.values.map((row) => row[m.yKey]);
  const pairs = dropGapRows(x, y);
  return { x: pairs.x, y: pairs.y, pairs };
}

/** A fitted curve aligned to ALL of the dataset's rows (gaps and dropped rows
 *  null/NaN), in register with the full-length plot x — the fit overlay. */
export function memberOverlay(ds: Dataset, pairs: FinitePairs, yFit: readonly (number | null)[]): (number | null)[] {
  const n = ds.data.time.length;
  const kept = activeRowIndices(n, droppedRows(ds));
  const aligned = restoreGapRows(yFit, pairs);
  return kept.length === n ? aligned : expandToFull(aligned, kept, n);
}

/** One sharing group per shared parameter, spanning every member. */
export function shareConstraints(
  names: readonly string[],
  shared: readonly boolean[],
  k: number,
): { param_name: string; datasets: number[] }[] {
  const all = Array.from({ length: k }, (_, i) => i);
  return names.filter((_, j) => shared[j]).map((param_name) => ({ param_name, datasets: [...all] }));
}

type Num = number | null;

export interface GlobalRow {
  param: string;
  /** "shared", or the member's label. */
  dataset: string;
  value: Num;
  error: Num;
}

/** Shared values once each, then every member's own (per-dataset) values. */
export function resultRows(r: GlobalFitResult, members: readonly GlobalMember[]): GlobalRow[] {
  const isShared = (i: number, j: number) => r.shared.some((g) => g.paramIdx === j && g.datasets.includes(i));
  const rows: GlobalRow[] = r.shared.map((g) => ({
    param: r.paramNames[g.paramIdx] ?? g.name,
    dataset: "shared",
    value: g.value,
    error: g.error,
  }));
  members.forEach((m, i) => {
    r.paramNames.forEach((param, j) => {
      if (!isShared(i, j)) rows.push({ param, dataset: m.label, value: r.params[i]?.[j] ?? null, error: r.errors[i]?.[j] ?? null });
    });
  });
  return rows;
}

/** One report row per member: every parameter (shared ones repeat), its
 *  error, and R². */
export function reportRecords(r: GlobalFitResult, members: readonly GlobalMember[]): Record<string, unknown>[] {
  return members.map((m, i) => {
    const rec: Record<string, unknown> = { dataset: m.label };
    r.paramNames.forEach((p, j) => {
      rec[p] = r.params[i]?.[j] ?? null;
      rec[`± ${p}`] = r.errors[i]?.[j] ?? null;
    });
    rec["R²"] = r.R2[i] ?? null;
    return rec;
  });
}
