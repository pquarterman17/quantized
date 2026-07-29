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
//
// JMP_GAP_PLAN J7 ("By" role): an optional By column runs the SAME dispatch
// (components/workshops/fityx/runLeg.ts) once per level of a categorical
// column (components/workshops/useByPartition.ts, shared with Distribution),
// on the ALREADY-analysis-view `data` partitioned into per-level DataStructs
// — guard #11 is satisfied upstream, By only partitions rows that already
// passed exclusions/the local filter. A level too small for its leg's own
// minimums (runLeg's thrown "need at least …" errors) surfaces as an honest
// "not enough data (n=…)" line instead of an error toast/crash.

import { useEffect, useMemo, useState } from "react";

import { reportEmit } from "../../../lib/api";
import { fmtNum } from "../../../lib/format";
import { channelModelingType, isCategorical } from "../../../lib/modeling";
import { analysisData } from "../../../lib/rowstate";
import type { ModelingType } from "../../../lib/types";
import { toast } from "../../../store/toasts";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { colValues, groupsForOneway, runLeg } from "./runLeg";
import type { BivariateResult, ContingencyResult, FitYByXKind, OnewayResult } from "./runLeg";
import { type ByColumnOption, type ByLevel, useByPartition } from "../useByPartition";

export type { BivariateResult, ContingencyResult, FitYByXKind, OnewayGroup, OnewayResult } from "./runLeg";

export interface FitYByXColumn {
  index: number;
  label: string;
}

/** One By level's landed (or failed) leg result, keyed by that level's
 *  label — the report/render unit for JMP_GAP_PLAN J7. */
export interface FitYByXLevelResult {
  label: string;
  n: number;
  oneway?: OnewayResult;
  bivariate?: BivariateResult;
  contingency?: ContingencyResult;
  /** Set instead of a result when the level had too few rows/levels for
   *  this leg — an honest line, not a thrown error. */
  error: string | null;
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
  // ── "By" grouping (JMP_GAP J7) ──────────────────────────────────────────
  byOptions: ByColumnOption[];
  byCol: number | null;
  setByCol: (i: number | null) => void;
  byLevels: ByLevel[];
  byResults: FitYByXLevelResult[];
  byBusy: boolean;
}

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

  // JMP_GAP J7 — By-column partitioning. `data` is already the analysis
  // view (guard #11), so every level below is post-exclusion/-filter too.
  // The By candidate list excludes whichever columns are already X/Y —
  // grouping by the very column already driving the leg would be redundant
  // (every level would just re-derive one X group).
  const byColumns = useMemo(() => columns.filter((c) => c.index !== xCol && c.index !== yCol), [columns, xCol, yCol]);
  const byPartition = useByPartition(active, data, byColumns);
  const [byResults, setByResults] = useState<FitYByXLevelResult[]>([]);
  const [byBusy, setByBusy] = useState(false);

  // A By column picked before X/Y changed underneath it (now colliding with
  // the new X or Y) resets to none rather than silently partitioning by a
  // column that no longer appears in `byOptions`.
  useEffect(() => {
    if (byPartition.byCol === xCol || byPartition.byCol === yCol) byPartition.setByCol(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xCol, yCol]);

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
    runLeg(data, kind, xCol, yCol, order)
      .then((leg) => {
        if (cancelled) return;
        setOneway(leg.oneway ?? null);
        setBivariate(leg.bivariate ?? null);
        setContingency(leg.contingency ?? null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "analysis failed");
        setOneway(null);
        setBivariate(null);
        setContingency(null);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [data, kind, xCol, yCol, order]);

  // JMP_GAP J7 — the SAME dispatch, once per By level. A level too small
  // for this leg (runLeg's thrown "need at least …" errors) reports an
  // honest "not enough data" line instead of surfacing as an error.
  useEffect(() => {
    if (byPartition.levels.length === 0 || kind === "unsupported") {
      setByResults([]);
      setByBusy(false);
      return;
    }
    let cancelled = false;
    setByBusy(true);
    Promise.all(
      byPartition.levels.map(async (lvl): Promise<FitYByXLevelResult> => {
        try {
          const leg = await runLeg(lvl.data, kind, xCol, yCol, order);
          return { label: lvl.label, n: lvl.data.time.length, ...leg, error: null };
        } catch (_e) {
          return {
            label: lvl.label,
            n: lvl.data.time.length,
            error: `not enough data (n=${lvl.data.time.length})`,
          };
        }
      }),
    )
      .then((results) => {
        if (!cancelled) setByResults(results);
      })
      .finally(() => {
        if (!cancelled) setByBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [byPartition.levels, kind, xCol, yCol, order]);

  function pendingGuard(action: string): boolean {
    if (!active?.pending) return false;
    useApp.getState().ensureBookData(active.id);
    setStatus(`still loading full data — try ${action} again in a moment`);
    return true;
  }

  /** One leg's result -> {title, columns?, records, caption?} for report
   *  emission — shared by the single-view and per-level (By) paths so the
   *  per-level records use exactly the same column shape, just with a
   *  leading `level` key. */
  function legRecords(
    leg: { oneway?: OnewayResult | null; bivariate?: BivariateResult | null; contingency?: ContingencyResult | null },
    level?: string,
  ): Record<string, unknown>[] {
    const withLevel = (r: Record<string, unknown>) => (level != null ? { level, ...r } : r);
    if (kind === "oneway" && leg.oneway) {
      return leg.oneway.groups.map((g) =>
        withLevel({ group: g.label, n: g.values.length, mean: mean(g.values), sd: sd(g.values) }),
      );
    }
    if (kind === "bivariate" && leg.bivariate) {
      const r = leg.bivariate.regression;
      const coeffs = (r.coeffs as number[] | undefined) ?? [];
      return [
        withLevel({
          N: r.N,
          order: leg.bivariate.order,
          intercept: coeffs[0],
          slope: coeffs[1],
          R2: r.R2,
          fStat: r.fStat,
          fPvalue: r.fPvalue,
        }),
      ];
    }
    if (kind === "contingency" && leg.contingency) {
      const expected = (leg.contingency.chiSquare.expected as number[][] | undefined) ?? [];
      const out: Record<string, unknown>[] = [];
      leg.contingency.rowLabels.forEach((rl, i) => {
        leg.contingency!.colLabels.forEach((cl, j) => {
          out.push(withLevel({ row: rl, col: cl, observed: leg.contingency!.table[i][j], expected: expected[i]?.[j] }));
        });
      });
      return out;
    }
    return [];
  }

  async function toReport(): Promise<void> {
    if (!active) return;
    if (pendingGuard("report")) return;
    setReportBusy(true);
    try {
      const refs = [{ kind: "dataset", id: active.id, name: active.name }];
      let title: string;
      let records: Record<string, unknown>[];
      let caption: string | undefined;

      if (byPartition.levels.length > 0) {
        const byLabel = byPartition.byOptions.find((c) => c.index === byPartition.byCol)?.label ?? "level";
        title = `${yLabel} by ${xLabel} — ${kind} — by ${byLabel}`;
        records = byResults.flatMap((r) => (r.error ? [] : legRecords(r, r.label)));
        if (records.length === 0) {
          setReportBusy(false);
          return;
        }
      } else if (kind === "oneway" && oneway) {
        title = `${yLabel} by ${xLabel} — oneway`;
        records = legRecords({ oneway });
        caption = `ANOVA F=${fmtNum(oneway.anova.fStat)}, p=${fmtNum(oneway.anova.pValue)}`;
      } else if (kind === "bivariate" && bivariate) {
        title = `${yLabel} by ${xLabel} — bivariate fit`;
        records = legRecords({ bivariate });
      } else if (kind === "contingency" && contingency) {
        title = `${xLabel} x ${yLabel} — contingency`;
        records = legRecords({ contingency });
        caption = `chi2=${fmtNum(contingency.chiSquare.chi2)}, p=${fmtNum(contingency.chiSquare.p_value)}`;
      } else {
        setReportBusy(false);
        return;
      }

      const columns =
        byPartition.levels.length > 0 && records.length > 0 ? Object.keys(records[0]) : undefined;
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
    byOptions: byPartition.byOptions,
    byCol: byPartition.byCol,
    setByCol: byPartition.setByCol,
    byLevels: byPartition.levels,
    byResults,
    byBusy,
  };
}

// `groupsForOneway`/`colValues` are re-exported for any lingering caller
// that imported them from this module before the J7 refactor moved the
// dispatch into runLeg.ts.
export { colValues, groupsForOneway };
