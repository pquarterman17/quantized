// Test chooser (#26) — state hook. Builds group vectors from the active
// dataset (columns mode: one group per picked column; group-by mode: a value
// column partitioned by a categorical column), asks /api/stats/recommend which
// test fits (assumption checks + plain-language reasons), then runs the
// recommended test one-click and can land the result as a #36 report. Reads
// the ANALYSIS view (rowstate.analysisData) so exclusions/filters are honored.

import { useMemo, useState } from "react";

import { reportEmit, statsRecommend, statsRunTest } from "../../../lib/api";
import { channelModelingType, isCategorical } from "../../../lib/modeling";
import { analysisData } from "../../../lib/rowstate";
import {
  buildRunRequest,
  groupsByCategory,
  groupsFromColumns,
  reportRecord,
  type GroupSpec,
  type Recommendation,
} from "../../../lib/statschooser";
import type { CalcResult, Dataset } from "../../../lib/types";
import { toast } from "../../../store/toasts";
import { useActiveDataset, useApp } from "../../../store/useApp";

export type ChooserMode = "columns" | "groupby";

export interface ChooserColumn {
  index: number;
  label: string;
}

export interface StatsChooserState {
  active: Dataset | null;
  columns: ChooserColumn[];
  mode: ChooserMode;
  setMode: (m: ChooserMode) => void;
  // columns mode
  cols: number[];
  toggleCol: (i: number) => void;
  // group-by mode
  valueCol: number;
  byCol: number;
  setValueCol: (i: number) => void;
  setByCol: (i: number) => void;
  byIsCategorical: boolean;
  // shared
  groups: GroupSpec[];
  paired: boolean;
  setPaired: (p: boolean) => void;
  pairable: boolean;
  busy: boolean;
  error: string | null;
  rec: Recommendation | null;
  testResult: CalcResult | null;
  recommend: () => Promise<void>;
  runRecommended: () => Promise<void>;
  toReport: () => Promise<void>;
}

export function useStatsChooser(): StatsChooserState {
  const active = useActiveDataset();
  const addReport = useApp((s) => s.addReport);
  const data = useMemo(() => analysisData(active), [active]);

  const columns = useMemo<ChooserColumn[]>(() => {
    if (!active) return [];
    const xName = String(active.data.metadata?.["x_column_name"] ?? "x");
    return [
      { index: -1, label: xName },
      ...active.data.labels.map((lab, i) => ({ index: i, label: lab })),
    ];
  }, [active]);

  const [mode, setMode] = useState<ChooserMode>("columns");
  const [cols, setCols] = useState<number[]>(() =>
    active && active.data.labels.length ? [0] : [],
  );
  const [byCol, setByCol] = useState<number>(() => firstCategorical(active) ?? 0);
  const [valueCol, setValueCol] = useState<number>(() =>
    firstContinuous(active, firstCategorical(active) ?? 0),
  );
  const [paired, setPaired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [testResult, setTestResult] = useState<CalcResult | null>(null);

  const groups = useMemo<GroupSpec[]>(() => {
    if (!data) return [];
    return mode === "columns"
      ? groupsFromColumns(data, cols)
      : groupsByCategory(data, valueCol, byCol);
  }, [data, mode, cols, valueCol, byCol]);

  const pairable =
    groups.length === 2 && groups[0].values.length === groups[1].values.length;
  const byIsCategorical =
    !!active && byCol >= 0 && isCategorical(channelModelingType(active, byCol));

  const toggleCol = (i: number) =>
    setCols((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i]));

  const invalidate = () => {
    setRec(null);
    setTestResult(null);
    setError(null);
  };

  async function recommend(): Promise<void> {
    if (groups.length === 0) return;
    setBusy(true);
    setError(null);
    setTestResult(null);
    try {
      const r = await statsRecommend({
        groups: groups.map((g) => g.values),
        paired: paired && pairable,
      });
      setRec(r);
    } catch (e) {
      setRec(null);
      setError(e instanceof Error ? e.message : "recommendation failed");
    } finally {
      setBusy(false);
    }
  }

  async function runRecommended(): Promise<void> {
    if (!rec) return;
    const req = buildRunRequest(
      rec.endpoint,
      groups.map((g) => g.values),
      rec.paired,
    );
    if (!req) {
      setError(`don't know how to run ${rec.endpoint}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setTestResult(await statsRunTest(req.path, req.body));
    } catch (e) {
      setTestResult(null);
      setError(e instanceof Error ? e.message : "test failed");
    } finally {
      setBusy(false);
    }
  }

  async function toReport(): Promise<void> {
    if (!rec || !testResult || !active) return;
    setBusy(true);
    try {
      const { report } = await reportEmit({
        kind: "stats_table",
        records: [reportRecord(rec.recommendation, testResult)],
        title: `${rec.recommendation} — ${active.name}`,
        caption: rec.reasons.join("; "),
        source_refs: [{ kind: "dataset", id: active.id, name: active.name }],
      });
      addReport(`${rec.recommendation} — ${active.name}`, report, active.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : "report failed", "danger");
    } finally {
      setBusy(false);
    }
  }

  return {
    active,
    columns,
    mode,
    setMode: (m) => {
      setMode(m);
      invalidate();
    },
    cols,
    toggleCol: (i) => {
      toggleCol(i);
      invalidate();
    },
    valueCol,
    byCol,
    setValueCol: (i) => {
      setValueCol(i);
      invalidate();
    },
    setByCol: (i) => {
      setByCol(i);
      invalidate();
    },
    byIsCategorical,
    groups,
    paired,
    setPaired: (p) => {
      setPaired(p);
      invalidate();
    },
    pairable,
    busy,
    error,
    rec,
    testResult,
    recommend,
    runRecommended,
    toReport,
  };
}

/** First channel that reads as categorical (nominal/ordinal), or null. */
function firstCategorical(active: Dataset | null): number | null {
  if (!active) return null;
  for (let i = 0; i < active.data.labels.length; i++) {
    if (isCategorical(channelModelingType(active, i))) return i;
  }
  return null;
}

/** First continuous channel that isn't `avoid`, else the first other channel. */
function firstContinuous(active: Dataset | null, avoid: number): number {
  if (!active) return 0;
  const n = active.data.labels.length;
  for (let i = 0; i < n; i++) {
    if (i !== avoid && !isCategorical(channelModelingType(active, i))) return i;
  }
  for (let i = 0; i < n; i++) if (i !== avoid) return i;
  return 0;
}
