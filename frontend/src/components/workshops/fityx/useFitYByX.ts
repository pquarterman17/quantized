// Fit Y by X workbench (JMP_GAP_PLAN J3) — state hook. Picks an X and a Y
// column from the active dataset and dispatches on their modeling types
// (lib/modeling.channelModelingType), the JMP "Fit Y by X" behavior:
//   categorical X x continuous Y -> oneway ANOVA (+ Levene, Tukey >2 levels,
//     recommend_test hint)
//   continuous X x continuous Y  -> bivariate linear/poly regression
//   categorical X x categorical Y -> contingency table (chi-square
//     independence, Fisher exact on 2x2)
// Reads the dataset's ANALYSIS view (lib/rowstate.analysisData) so excluded
// rows (#50) drop from every leg — the row-state chokepoint (architecture
// guard #11). Category labels resolve the same way bar charts/facets do
// (lib/barlayout.categoryLevels/resolveCategoryLabels) so they match plots.

import { useEffect, useMemo, useState } from "react";

import {
  reportEmit,
  statsAnova,
  statsChiSquareIndependence,
  statsFisherExact,
  statsLevene,
  statsRecommend,
  statsRegression,
  statsTukey,
} from "../../../lib/api";
import { categoryLevels, resolveCategoryLabels } from "../../../lib/barlayout";
import { fmtNum } from "../../../lib/format";
import { channelModelingType, isCategorical } from "../../../lib/modeling";
import { analysisData } from "../../../lib/rowstate";
import type { Recommendation } from "../../../lib/statschooser";
import type { CalcResult, DataStruct, ModelingType } from "../../../lib/types";
import { toast } from "../../../store/toasts";
import { useActiveDataset, useApp } from "../../../store/useApp";

export interface FitYByXColumn {
  index: number;
  label: string;
}

/** "unsupported" = a nominal/ordinal Y against a continuous X — JMP maps
 *  that combination to logistic fitting, out of this workbench's 3 legs. */
export type FitYByXKind = "oneway" | "bivariate" | "contingency" | "unsupported";

export interface OnewayGroup {
  label: string;
  values: number[];
}

export interface OnewayResult {
  groups: OnewayGroup[];
  anova: CalcResult;
  /** null when a group has <2 observations (Levene needs variance per group). */
  levene: CalcResult | null;
  /** null when only 2 levels (Tukey needs >2 to be more than a t-test). */
  tukey: CalcResult | null;
  recommend: Recommendation | null;
}

export interface BivariateResult {
  x: number[];
  y: number[];
  order: number;
  regression: CalcResult;
}

export interface ContingencyResult {
  rowLabels: string[];
  colLabels: string[];
  table: number[][];
  chiSquare: CalcResult;
  /** null unless the table is 2x2 (Fisher exact's only valid shape). */
  fisher: CalcResult | null;
}

export interface FitYByXState {
  hasData: boolean;
  datasetId: string | null;
  columns: FitYByXColumn[];
  xCol: number;
  yCol: number;
  setXCol: (i: number) => void;
  setYCol: (i: number) => void;
  xLabel: string;
  yLabel: string;
  kind: FitYByXKind;
  /** Polynomial order for the bivariate leg (1 = linear). Ignored elsewhere. */
  order: number;
  setOrder: (order: number) => void;
  busy: boolean;
  error: string | null;
  oneway: OnewayResult | null;
  bivariate: BivariateResult | null;
  contingency: ContingencyResult | null;
  reportBusy: boolean;
  toReport: () => Promise<void>;
}

const colValues = (data: DataStruct, index: number): number[] =>
  index < 0 ? data.time : data.values.map((row) => row[index]);

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

function sd(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  const ss = xs.reduce((a, b) => a + (b - m) ** 2, 0);
  return Math.sqrt(ss / (xs.length - 1));
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

/** The time axis (-1) is never categorical (mirrors lib/plotdata.ts). */
function colType(active: ReturnType<typeof useActiveDataset>, index: number): ModelingType {
  if (!active || index < 0) return "continuous";
  return channelModelingType(active, index);
}

/** Partition yCol's finite values by xCol's finite levels, labeled the same
 *  way bar charts resolve category labels (an Origin text column when one
 *  consistently covers every level, else formatted numeric levels). */
function groupsForOneway(data: DataStruct, xCol: number, yCol: number): OnewayGroup[] {
  const levels = categoryLevels(data, xCol);
  const labels = resolveCategoryLabels(data, xCol, levels);
  const xv = colValues(data, xCol);
  const yv = colValues(data, yCol);
  const buckets = new Map<number, number[]>();
  const n = Math.min(xv.length, yv.length);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(xv[i]) || !Number.isFinite(yv[i])) continue;
    const bucket = buckets.get(xv[i]);
    if (bucket) bucket.push(yv[i]);
    else buckets.set(xv[i], [yv[i]]);
  }
  return levels.map((lvl, i) => ({ label: labels[i], values: buckets.get(lvl) ?? [] }));
}

export function useFitYByX(): FitYByXState {
  const active = useActiveDataset();
  const addReport = useApp((s) => s.addReport);
  const setStatus = useApp((s) => s.setStatus);
  const [reportBusy, setReportBusy] = useState(false);
  const [order, setOrder] = useState(1);

  const data = useMemo(() => analysisData(active), [active]);

  const columns = useMemo<FitYByXColumn[]>(() => {
    if (!active) return [];
    const xName = String(active.data.metadata?.["x_column_name"] ?? "x");
    return [
      { index: -1, label: xName },
      ...active.data.labels.map((lab, i) => ({ index: i, label: lab })),
    ];
  }, [active]);

  const [xCol, setXCol] = useState<number>(() => firstCategorical(active) ?? 0);
  const [yCol, setYCol] = useState<number>(() => firstContinuous(active, firstCategorical(active) ?? 0));

  const labelOf = (i: number) => columns.find((c) => c.index === i)?.label ?? (i < 0 ? "x" : `col ${i}`);
  const xLabel = labelOf(xCol);
  const yLabel = labelOf(yCol);

  const xType = colType(active, xCol);
  const yType = colType(active, yCol);
  const kind: FitYByXKind = isCategorical(xType)
    ? (isCategorical(yType) ? "contingency" : "oneway")
    : (isCategorical(yType) ? "unsupported" : "bivariate");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oneway, setOneway] = useState<OnewayResult | null>(null);
  const [bivariate, setBivariate] = useState<BivariateResult | null>(null);
  const [contingency, setContingency] = useState<ContingencyResult | null>(null);

  useEffect(() => {
    if (!data || kind === "unsupported") {
      setOneway(null);
      setBivariate(null);
      setContingency(null);
      setError(
        kind === "unsupported"
          ? "categorical Y against a continuous X isn't supported here (JMP maps that to a logistic fit)"
          : null,
      );
      return;
    }
    let cancelled = false;
    setBusy(true);
    setError(null);

    async function run(): Promise<void> {
      try {
        if (kind === "oneway") {
          const groups = groupsForOneway(data as DataStruct, xCol, yCol).filter((g) => g.values.length > 0);
          if (groups.length < 2) throw new Error("need at least 2 non-empty levels for oneway");
          const valueArrays = groups.map((g) => g.values);
          const [anova, levene, recommend] = await Promise.all([
            statsAnova(valueArrays),
            valueArrays.every((g) => g.length >= 2)
              ? statsLevene(valueArrays).catch(() => null)
              : Promise.resolve(null),
            statsRecommend({ groups: valueArrays }).catch(() => null),
          ]);
          const tukey = groups.length > 2 ? await statsTukey(valueArrays).catch(() => null) : null;
          if (cancelled) return;
          setOneway({ groups, anova, levene, tukey, recommend });
          setBivariate(null);
          setContingency(null);
        } else if (kind === "bivariate") {
          const xv = colValues(data as DataStruct, xCol);
          const yv = colValues(data as DataStruct, yCol);
          const n = Math.min(xv.length, yv.length);
          const xs: number[] = [];
          const ys: number[] = [];
          for (let i = 0; i < n; i++) {
            if (Number.isFinite(xv[i]) && Number.isFinite(yv[i])) {
              xs.push(xv[i]);
              ys.push(yv[i]);
            }
          }
          if (xs.length < order + 2) {
            throw new Error(`need at least ${order + 2} paired points for order-${order} regression`);
          }
          const regression = await statsRegression({ x: xs, y: ys, order });
          if (cancelled) return;
          setBivariate({ x: xs, y: ys, order, regression });
          setOneway(null);
          setContingency(null);
        } else if (kind === "contingency") {
          const xLevels = categoryLevels(data as DataStruct, xCol);
          const yLevels = categoryLevels(data as DataStruct, yCol);
          if (xLevels.length < 2 || yLevels.length < 2) {
            throw new Error("need at least 2 levels in both columns for a contingency table");
          }
          const rowLabels = resolveCategoryLabels(data as DataStruct, xCol, xLevels);
          const colLabels = resolveCategoryLabels(data as DataStruct, yCol, yLevels);
          const xv = colValues(data as DataStruct, xCol);
          const yv = colValues(data as DataStruct, yCol);
          const rowIndex = new Map(xLevels.map((lvl, i) => [lvl, i]));
          const colIndex = new Map(yLevels.map((lvl, i) => [lvl, i]));
          const table: number[][] = xLevels.map(() => yLevels.map(() => 0));
          const n = Math.min(xv.length, yv.length);
          for (let i = 0; i < n; i++) {
            const ri = rowIndex.get(xv[i]);
            const ci = colIndex.get(yv[i]);
            if (ri === undefined || ci === undefined) continue;
            table[ri][ci] += 1;
          }
          const chiSquare = await statsChiSquareIndependence(table);
          const fisher =
            xLevels.length === 2 && yLevels.length === 2
              ? await statsFisherExact(table).catch(() => null)
              : null;
          if (cancelled) return;
          setContingency({ rowLabels, colLabels, table, chiSquare, fisher });
          setOneway(null);
          setBivariate(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "analysis failed");
          setOneway(null);
          setBivariate(null);
          setContingency(null);
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [data, kind, xCol, yCol, order]);

  function pendingGuard(action: string): boolean {
    if (!active?.pending) return false;
    useApp.getState().ensureBookData(active.id);
    setStatus(`still loading full data — try ${action} again in a moment`);
    return true;
  }

  async function toReport(): Promise<void> {
    if (!active) return;
    if (pendingGuard("report")) return;
    setReportBusy(true);
    try {
      const refs = [{ kind: "dataset", id: active.id, name: active.name }];
      let title: string;
      let records: Record<string, unknown>[];
      let columns: string[] | undefined;
      let caption: string | undefined;

      if (kind === "oneway" && oneway) {
        title = `${yLabel} by ${xLabel} — oneway`;
        columns = ["group", "n", "mean", "sd"];
        records = oneway.groups.map((g) => ({
          group: g.label,
          n: g.values.length,
          mean: mean(g.values),
          sd: sd(g.values),
        }));
        caption = `ANOVA F=${fmtNum(oneway.anova.fStat)}, p=${fmtNum(oneway.anova.pValue)}`;
      } else if (kind === "bivariate" && bivariate) {
        const r = bivariate.regression;
        const coeffs = (r.coeffs as number[] | undefined) ?? [];
        title = `${yLabel} by ${xLabel} — bivariate fit`;
        records = [
          {
            N: r.N,
            order: bivariate.order,
            intercept: coeffs[0],
            slope: coeffs[1],
            R2: r.R2,
            fStat: r.fStat,
            fPvalue: r.fPvalue,
          },
        ];
      } else if (kind === "contingency" && contingency) {
        title = `${xLabel} x ${yLabel} — contingency`;
        columns = ["row", "col", "observed", "expected"];
        const expected = (contingency.chiSquare.expected as number[][] | undefined) ?? [];
        records = [];
        contingency.rowLabels.forEach((rl, i) => {
          contingency.colLabels.forEach((cl, j) => {
            records.push({
              row: rl,
              col: cl,
              observed: contingency.table[i][j],
              expected: expected[i]?.[j],
            });
          });
        });
        caption = `chi2=${fmtNum(contingency.chiSquare.chi2)}, p=${fmtNum(contingency.chiSquare.p_value)}`;
      } else {
        return;
      }

      const { report } = await reportEmit({ kind: "stats_table", records, title, columns, caption, source_refs: refs });
      addReport(title, report, active.id);
      setStatus(`emitted ${title} report`);
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
    xCol,
    yCol,
    setXCol,
    setYCol,
    xLabel,
    yLabel,
    kind,
    order,
    setOrder,
    busy,
    error,
    oneway,
    bivariate,
    contingency,
    reportBusy,
    toReport,
  };
}
