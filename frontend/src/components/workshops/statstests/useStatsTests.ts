// Statistical tests workshop — state hook. Holds the picked test, its column
// picks and parameters; Run builds the request from the ANALYSIS view
// (rowstate.analysisData, so exclusions/filters are honored) through
// store/pendingEdit.withResolved (a lazy Origin book loads its full data
// first), posts it, and turns the answer into one plain-language sentence plus
// tables (lib/statsTestsResults). Copy / Export CSV / → Report hand the same
// tables on. Nothing runs automatically: a test is a deliberate question.

import { useEffect, useMemo, useRef, useState } from "react";

import { reportEmit } from "../../../lib/api";
import { runStatsTest, type StatsTestId } from "../../../lib/api/statsTests";
import { copyText } from "../../../lib/clipboard";
import { csvBlob } from "../../../lib/csvCell";
import { saveBlob } from "../../../lib/download";
import { channelModelingType, isCategorical } from "../../../lib/modeling";
import { analysisData } from "../../../lib/rowstate";
import {
  DEFAULT_PARAMS,
  buildTestRequest,
  testDef,
  type TestDef,
  type TestParams,
  type TestSelection,
} from "../../../lib/statsTests";
import { describeResult, outputToCSV, outputToTSV, type TestOutput } from "../../../lib/statsTestsResults";
import type { Dataset } from "../../../lib/types";
import { withResolved } from "../../../store/pendingEdit";
import { toast } from "../../../store/toasts";
import { useActiveDataset, useApp } from "../../../store/useApp";

export interface TestColumn {
  index: number;
  label: string;
  categorical: boolean;
}

export interface StatsTestsState {
  active: Dataset | null;
  columns: TestColumn[];
  testId: StatsTestId;
  def: TestDef;
  setTestId: (id: StatsTestId) => void;
  sel: TestSelection;
  setSel: (patch: Partial<TestSelection>) => void;
  toggleCol: (i: number) => void;
  params: TestParams;
  setParams: (patch: Partial<TestParams>) => void;
  busy: boolean;
  error: string | null;
  output: TestOutput | null;
  run: () => Promise<void>;
  copy: () => Promise<void>;
  exportCsv: () => void;
  toReport: () => Promise<void>;
}

/** Sensible first picks: continuous columns as data, categorical ones as factors. */
function defaultSelection(columns: TestColumn[]): TestSelection {
  const cont = columns.filter((c) => !c.categorical && c.index >= 0).map((c) => c.index);
  const cat = columns.filter((c) => c.categorical).map((c) => c.index);
  const x = cont[0] ?? 0;
  return {
    x,
    y: cont.find((c) => c !== x) ?? -1,
    cols: cont.slice(0, 2),
    byCol: cat[0] ?? 0,
    byCol2: cat[1] ?? cat[0] ?? 1,
    groupMode: cat.length > 0 ? "category" : "columns",
  };
}

export function useStatsTests(): StatsTestsState {
  const active = useActiveDataset();
  const addReport = useApp((s) => s.addReport);
  const setStatus = useApp((s) => s.setStatus);

  const columns = useMemo<TestColumn[]>(() => {
    if (!active) return [];
    const xName = String(active.data.metadata?.["x_column_name"] ?? "x");
    return [
      { index: -1, label: xName, categorical: false },
      ...active.data.labels.map((lab, i) => ({
        index: i,
        label: lab,
        categorical: isCategorical(channelModelingType(active, i)),
      })),
    ];
  }, [active]);

  const [testId, setTestIdRaw] = useState<StatsTestId>("anderson");
  const [sel, setSelRaw] = useState<TestSelection>(() => defaultSelection(columns));
  const [params, setParamsRaw] = useState<TestParams>(DEFAULT_PARAMS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<TestOutput | null>(null);
  const [ranTest, setRanTest] = useState<StatsTestId>("anderson");
  const seq = useRef(0);

  const invalidate = () => {
    seq.current++;
    setBusy(false);
    setOutput(null);
    setError(null);
  };

  // Column indices from the PREVIOUS dataset would silently test the wrong
  // columns, so re-derive the picks whenever the active dataset changes.
  useEffect(() => {
    setSelRaw(defaultSelection(columns));
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  async function run(): Promise<void> {
    const request = ++seq.current;
    const id = testId;
    setBusy(true);
    setError(null);
    setOutput(null);
    let built;
    if (id === "power" || !active) {
      built = buildTestRequest(id, null, sel, params);
    } else {
      const resolved = await withResolved(useApp.getState, active.id, "the statistical test", (ds) =>
        buildTestRequest(id, analysisData(ds), sel, params),
      );
      if (request !== seq.current) return;
      built = resolved.ok ? resolved.value : { ok: false as const, error: resolved.error };
    }
    if (!built.ok) {
      setBusy(false);
      setError(built.error);
      return;
    }
    try {
      const result = await runStatsTest(built.request);
      if (request !== seq.current) return;
      setOutput(describeResult(result, built.labels, params.alpha));
      setRanTest(id);
    } catch (e) {
      if (request !== seq.current) return;
      setError(e instanceof Error ? e.message : "the test failed");
    } finally {
      if (request === seq.current) setBusy(false);
    }
  }

  const fileStem = `${ranTest}${active ? `_${active.name}` : ""}`.replace(/[^\w.-]+/g, "_");

  async function copy(): Promise<void> {
    if (!output) return;
    const ok = await copyText(outputToTSV(output));
    setStatus(ok ? `copied ${testDef(ranTest).label} results to clipboard` : "clipboard unavailable");
  }

  function exportCsv(): void {
    if (!output) return;
    saveBlob(csvBlob(outputToCSV(output)), `${fileStem}.csv`);
  }

  async function toReport(): Promise<void> {
    if (!output) return;
    const [main] = output.tables;
    const title = `${testDef(ranTest).label}${active ? ` — ${active.name}` : ""}`;
    setBusy(true);
    try {
      const { report } = await reportEmit({
        kind: "stats_table",
        records: main.rows.map((row) => Object.fromEntries(main.columns.map((c, i) => [c || "row", row[i]]))),
        columns: main.columns.map((c) => c || "row"),
        title,
        caption: output.sentence,
        source_refs: active ? [{ kind: "dataset", id: active.id, name: active.name }] : [],
      });
      addReport(title, report, active?.id ?? null);
    } catch (e) {
      toast(`could not add to report — ${e instanceof Error ? e.message : "unknown error"}`, "danger");
    } finally {
      setBusy(false);
    }
  }

  return {
    active,
    columns,
    testId,
    def: testDef(testId),
    setTestId: (id) => {
      setTestIdRaw(id);
      invalidate();
    },
    sel,
    setSel: (patch) => {
      setSelRaw((s) => ({ ...s, ...patch }));
      invalidate();
    },
    toggleCol: (i) => {
      setSelRaw((s) => ({ ...s, cols: s.cols.includes(i) ? s.cols.filter((c) => c !== i) : [...s.cols, i] }));
      invalidate();
    },
    params,
    setParams: (patch) => {
      setParamsRaw((p) => ({ ...p, ...patch }));
      invalidate();
    },
    busy,
    error,
    output,
    run,
    copy,
    exportCsv,
    toReport,
  };
}
