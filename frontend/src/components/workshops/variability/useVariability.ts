// Variability chart + variance components workbench (JMP_GAP_PLAN J8 UI) —
// state hook. Backend shipped 2026-07-29 (calc.stats_varcomp + routes/
// stats_varcomp.py): two-level nested (hierarchical) ANOVA, ANOVA/EMS
// variance components, and the `variability_summary` chart data contract.
// This hook picks a Response (continuous), Factor A (outer nesting), and
// Factor B (inner, nested-in-A) column, builds the nested-groups wire shape
// (lib/variability), and fetches all three endpoints — variance components
// only when the landed nested-ANOVA result says B(A) and Error are both
// estimable (statsVarianceComponents 422s otherwise).
//
// Reads the dataset's ANALYSIS view (lib/rowstate.analysisData) so excluded
// rows (#50) and the local filter (#53) drop before grouping — the guarded
// row-state chokepoint (#11), same as useMultivar/useFitYByX.

import { useEffect, useMemo, useState } from "react";

import {
  reportEmit,
  statsNestedAnova,
  statsVarianceComponents,
  statsVariabilitySummary,
  type NestedAnovaResponse,
  type VarianceComponentsResponse,
  type VariabilitySummaryResponse,
} from "../../../lib/api";
import { fmtNum } from "../../../lib/format";
import { channelModelingType, isCategorical } from "../../../lib/modeling";
import { analysisData } from "../../../lib/rowstate";
import type { ModelingType } from "../../../lib/types";
import { buildNestedLevels, toWireGroups, type VariabilityFactorLevel } from "../../../lib/variability";
import { toast } from "../../../store/toasts";
import { useActiveDataset, useApp } from "../../../store/useApp";

export interface VariabilityColumn {
  index: number;
  label: string;
}

export interface VariabilityState {
  hasData: boolean;
  columns: VariabilityColumn[];
  responseCol: number;
  setResponseCol: (i: number) => void;
  factorACol: number;
  setFactorACol: (i: number) => void;
  factorBCol: number;
  setFactorBCol: (i: number) => void;
  responseLabel: string;
  factorALabel: string;
  factorBLabel: string;

  levels: VariabilityFactorLevel[];
  /** Nested design needs >=2 non-empty factor-A levels (calc.stats_varcomp). */
  tooFewLevels: boolean;

  busy: boolean;
  error: string | null;
  anova: NestedAnovaResponse | null;
  varComp: VarianceComponentsResponse | null;
  varCompNote: string | null;
  summary: VariabilitySummaryResponse | null;

  reportBusy: boolean;
  toReport: () => Promise<void>;
}

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

function colType(active: ReturnType<typeof useActiveDataset>, index: number): ModelingType {
  if (!active || index < 0) return "continuous";
  return channelModelingType(active, index);
}

/** First channel that reads as categorical (nominal/ordinal), skipping `avoid`. */
function firstCategorical(active: ReturnType<typeof useActiveDataset>, avoid: number[]): number | null {
  if (!active) return null;
  for (let i = 0; i < active.data.labels.length; i++) {
    if (avoid.includes(i)) continue;
    if (isCategorical(channelModelingType(active, i))) return i;
  }
  return null;
}

/** Second categorical channel distinct from the first pick, or the first
 *  categorical channel repeated if there's only one (the panel still shows
 *  something sensible; `tooFewLevels`/backend validation catches a
 *  degenerate design). */
function secondCategorical(active: ReturnType<typeof useActiveDataset>, first: number | null): number {
  const second = firstCategorical(active, first == null ? [] : [first]);
  return second ?? first ?? 0;
}

/** First continuous channel not already used as a factor. */
function firstContinuous(active: ReturnType<typeof useActiveDataset>, avoid: number[]): number {
  if (!active) return 0;
  const n = active.data.labels.length;
  for (let i = 0; i < n; i++) {
    if (!avoid.includes(i) && !isCategorical(channelModelingType(active, i))) return i;
  }
  for (let i = 0; i < n; i++) if (!avoid.includes(i)) return i;
  return 0;
}

export function useVariability(): VariabilityState {
  const active = useActiveDataset();
  const addReport = useApp((s) => s.addReport);
  const setStatus = useApp((s) => s.setStatus);
  const [reportBusy, setReportBusy] = useState(false);

  const data = useMemo(() => analysisData(active), [active]);

  const columns = useMemo<VariabilityColumn[]>(() => {
    if (!active) return [];
    const xName = String(active.data.metadata?.["x_column_name"] ?? "x");
    return [
      { index: -1, label: xName },
      ...active.data.labels.map((lab, i) => ({ index: i, label: lab })),
    ];
  }, [active]);

  const [factorACol, setFactorACol] = useState<number>(() => firstCategorical(active, []) ?? 0);
  const [factorBCol, setFactorBCol] = useState<number>(() =>
    secondCategorical(active, firstCategorical(active, [])),
  );
  const [responseCol, setResponseCol] = useState<number>(() =>
    firstContinuous(active, [firstCategorical(active, []) ?? -99, secondCategorical(active, firstCategorical(active, []))]),
  );

  // A dataset switch invalidates the previous picks — same convention as
  // useMultivar/useFitYByX (a new dataset's channel set is unrelated).
  useEffect(() => {
    const a = firstCategorical(active, []);
    const b = secondCategorical(active, a);
    setFactorACol(a ?? 0);
    setFactorBCol(b);
    setResponseCol(firstContinuous(active, [a ?? -99, b]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  const labelOf = (i: number) => columns.find((c) => c.index === i)?.label ?? (i < 0 ? "x" : `col ${i}`);
  const responseLabel = labelOf(responseCol);
  const factorALabel = labelOf(factorACol);
  const factorBLabel = labelOf(factorBCol);

  const levels = useMemo(() => {
    if (!data) return [];
    return buildNestedLevels(data, responseCol, factorACol, factorBCol);
  }, [data, responseCol, factorACol, factorBCol]);

  const tooFewLevels = levels.length < 2;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [anova, setAnova] = useState<NestedAnovaResponse | null>(null);
  const [varComp, setVarComp] = useState<VarianceComponentsResponse | null>(null);
  const [varCompNote, setVarCompNote] = useState<string | null>(null);
  const [summary, setSummary] = useState<VariabilitySummaryResponse | null>(null);

  useEffect(() => {
    if (tooFewLevels) {
      setAnova(null);
      setVarComp(null);
      setVarCompNote(null);
      setSummary(null);
      setError("need at least 2 non-empty levels of the Factor A column");
      setBusy(false);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setError(null);
    const groups = toWireGroups(levels);
    (async () => {
      try {
        const [anovaRes, summaryRes] = await Promise.all([
          statsNestedAnova(groups),
          statsVariabilitySummary(groups),
        ]);
        if (cancelled) return;
        setAnova(anovaRes);
        setSummary(summaryRes);
        if (anovaRes.b_within_a_estimable && anovaRes.error_estimable) {
          setVarCompNote(null);
          const vc = await statsVarianceComponents(groups);
          if (!cancelled) setVarComp(vc);
        } else {
          setVarComp(null);
          setVarCompNote(
            "variance components need >=1 Factor-A level with >=2 Factor-B subgroups and >=1 cell with >=2 replicates",
          );
        }
      } catch (e) {
        if (cancelled) return;
        setError(errMsg(e, "variability analysis failed"));
        setAnova(null);
        setVarComp(null);
        setSummary(null);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [levels, tooFewLevels]);

  async function toReport(): Promise<void> {
    if (!active || !anova || !summary) return;
    setReportBusy(true);
    try {
      const refs = [{ kind: "dataset", id: active.id, name: active.name }];
      const title = `${responseLabel} variability by ${factorALabel} / ${factorBLabel}`;
      const anovaRecords = anova.table.map((r) => ({
        source: r.source,
        SS: r.SS,
        df: r.df,
        MS: r.MS,
        F: r.F,
        p: r.p,
      }));
      const varCompRecords = varComp
        ? [
            { component: "A", variance: varComp.sigma2_A, pct: varComp.pct_A },
            { component: "B(A)", variance: varComp.sigma2_B_within_A, pct: varComp.pct_B_within_A },
            { component: "Error", variance: varComp.sigma2_error, pct: varComp.pct_error },
          ]
        : [];
      const records = [...anovaRecords, ...varCompRecords];
      const caption = `grand mean ${fmtNum(summary.grand_mean)}, N=${summary.grand_n}, ${anova.a_tested_against === "B(A)" ? "A tested against B(A)" : "A tested against Error (B(A) not estimable)"}`;
      const { report } = await reportEmit({
        kind: "stats_table",
        records,
        title,
        columns: ["source", "SS", "df", "MS", "F", "p", "component", "variance", "pct"],
        caption,
        source_refs: refs,
      });
      addReport(title, report, active.id);
      setStatus(`emitted ${title} report`);
    } catch (e) {
      toast(errMsg(e, "report failed"), "danger");
    } finally {
      setReportBusy(false);
    }
  }

  return {
    hasData: !!active,
    columns,
    responseCol,
    setResponseCol,
    factorACol,
    setFactorACol,
    factorBCol,
    setFactorBCol,
    responseLabel,
    factorALabel,
    factorBLabel,
    levels,
    tooFewLevels,
    busy,
    error,
    anova,
    varComp,
    varCompNote,
    summary,
    reportBusy,
    toReport,
  };
}

// Exported so tests / the panel can read a column's modeling type without
// re-deriving the same lookup this hook uses internally.
export { colType };

// Re-exported so sub-components (VariabilityChart, VarianceComponentsView)
// take their prop types from this hook's module, not lib/api directly — the
// fityx/multivar convention (types travel with the state they came from).
export type { NestedAnovaResponse, VarianceComponentsResponse, VariabilitySummaryResponse };
