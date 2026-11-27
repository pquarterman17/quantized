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
import { ROW_POLICY, resolveAnalysisInputs, type AnalysisInputs } from "../../../lib/analysisInputs";
import {
  DEFAULT_PARAMS,
  buildTestRequest,
  testColumns,
  testDef,
  type TestDef,
  type TestParams,
  type TestSelection,
} from "../../../lib/statsTests";
import { describeResult, outputToCSV, outputToTSV, type TestOutput } from "../../../lib/statsTestsResults";
import type { DataStruct, Dataset } from "../../../lib/types";
import { addReportWithProvenance } from "../../../store/addReportWithProvenance";
import { withResolved } from "../../../store/pendingEdit";
import { publishStatisticalTestResult } from "../../../store/statisticalTestResults";
import { useStatsTestsStore } from "../../../store/statsTests";
import { toast } from "../../../store/toasts";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { kaplanMeierColumns } from "../../../lib/kaplanMeierReopenSeed";
import { withColumnSpecs } from "./specPrefill";
import { kmRunOf, type KmRun } from "./useKmCurveCommit";
import { rowTRunOf, type RowTRun } from "./useRowTCommit";
import { rowRangeKey } from "../../../lib/rangedView";
import { rowRangeOn } from "../../../store/analysisSelection";
import { useRowRangeOf } from "../analysisselection/useRowRangeOf";
import { rowsColumns } from "../../../lib/statsTestsRows";
import { useAnalysisInputs } from "../analysisselection/useAnalysisInputs";
import { afterCommit } from "../workbench/afterCommit";
import { datasetInputsToken } from "../workbench/inputsKey";
import { useRunStamp } from "../workbench/useRunStamp";
import { defaultAlpha } from "../../../lib/locale";
import { defaultSelection, pairOnTestChange } from "../../../lib/statsTestsDefaults";

export interface TestColumn {
  index: number;
  label: string;
  categorical: boolean;
}

export interface StatsTestsState {
  active: Dataset | null;
  /** What the picked test analyses, under the shared input contract; null for
   *  a test that reads no data (power). */
  inputs: AnalysisInputs | null;
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
  /** The Library result this output was saved as, or null (lane RB4). */
  savedId: string | null;
  /** Why this output has no saved result (the save itself failed), or null. */
  saveError: string | null;
  /** The test that produced `output` (the picker may have moved since). */
  ranTest: StatsTestId;
  /** The shown output ran on source rows that have since changed (Copy / Export / Report are withheld). */
  stale: boolean;
  /** The Kaplan-Meier answer on screen (null for any other test or once settings change). */
  km: KmRun | null;
  /** The row-wise t-test answer on screen (null for any other test or once settings change). */
  rowRun: RowTRun | null;
  run: () => Promise<void>;
  copy: () => Promise<void>;
  exportCsv: () => void;
  toReport: () => Promise<void>;
}

export function useStatsTests(): StatsTestsState {
  const active = useActiveDataset();
  const setStatus = useApp((s) => s.setStatus);
  const requested = useStatsTestsStore((s) => s.request);
  const consumeRequest = useStatsTestsStore((s) => s.consumeRequest);

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
  const [sel, setSelRaw] = useState<TestSelection>(() => defaultSelection(columns, "anderson"));
  const [params, setParamsRaw] = useState<TestParams>(() => ({ ...DEFAULT_PARAMS, alpha: defaultAlpha() }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<TestOutput | null>(null);
  // The Library result THIS output was saved as (every Run saves; a repeat of
  // the same question on the same data returns the existing one). Cleared with
  // the output, so the book never pairs an output with another run's result.
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [km, setKm] = useState<KmRun | null>(null);
  const [rowRun, setRowRun] = useState<RowTRun | null>(null);
  const [ranTest, setRanTest] = useState<StatsTestId>("anderson");
  const seq = useRef(0);
  // Lane WB6: a settings change still drops the output (invalidate); a change to
  // the SOURCE rows / data after the run marks it out of date instead.
  // A change of the row range after a run marks the output out of date, like a data edit.
  const rowRange = useRowRangeOf(active?.id);
  const stamp = useRunStamp(testDef(testId).input === "none" ? "" : `${datasetInputsToken(active)}|${rowRangeKey(rowRange)}`);
  const stale = output !== null && stamp.stale;

  // The shared input contract (lib/analysisInputs): the active worksheet's
  // analysis view over the columns the picked test reads. Run resolves the same
  // contract against the FULLY LOADED worksheet, so a lazy Origin preview is
  // never tested and a refusal is the error shown.
  const inputs = useAnalysisInputs({
    noX: true, yKeys: testColumns(testId, sel, params), policy: ROW_POLICY.analysisView, load: testDef(testId).input !== "none",
  });

  const invalidate = () => {
    seq.current++;
    stamp.record(null);
    setBusy(false);
    setOutput(null);
    setSavedId(null);
    setSaveError(null);
    setKm(null);
    setRowRun(null);
    setError(null);
  };

  // Column indices from the PREVIOUS dataset would silently test the wrong
  // columns, so re-derive the picks whenever the active dataset changes.
  useEffect(() => {
    setSelRaw(defaultSelection(columns, testId));
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  useEffect(() => {
    if (!requested) return;
    setTestIdRaw(requested.testId);
    setSelRaw({ ...requested.selection, cols: [...requested.selection.cols] });
    setParamsRaw({ ...requested.params });
    seq.current++;
    stamp.record(null);
    setBusy(false);
    setOutput(null);
    setSavedId(null);
    setSaveError(null);
    setKm(null);
    setRowRun(null);
    setError(null);
    consumeRequest();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `stamp` is a fresh object each render
  }, [consumeRequest, requested]);

  async function run(): Promise<void> {
    const request = ++seq.current;
    const id = testId;
    const runSelection = { ...sel, cols: [...sel.cols] };
    const prefill = withColumnSpecs(id, active, runSelection, params);
    const runParams = { ...prefill.params };
    let resultSource: Dataset | null = null;
    // The rows the run read (source worksheet rows; a row range narrows them) and,
    // when a range applied, exactly that data, so the saved record names its rows.
    let ranRows: number[] | null = null;
    let ranView: DataStruct | null = null;
    if (prefill.filled.length) setStatus(`${prefill.filled.join(", ")} taken from the spec limits of "${prefill.column}"`);
    setBusy(true);
    setError(null);
    setOutput(null);
    setSavedId(null);
    setSaveError(null);
    setKm(null);
    setRowRun(null);
    stamp.record(null);
    let built;
    if (testDef(id).input === "none" || !active) {
      built = buildTestRequest(id, null, runSelection, runParams);
    } else {
      const resolved = await withResolved(useApp.getState, active.id, "the statistical test", (ds) => {
        resultSource = ds;
        // With no column picked yet the contract would refuse with its generic
        // "no response" reason, hiding the test's own, more specific pick
        // message; resolve the row view over the X column instead and let
        // buildTestRequest say what is missing.
        const picked = testColumns(id, runSelection, runParams);
        const input = resolveAnalysisInputs({
          datasets: [ds], activeId: ds.id, noX: true, yKeys: picked.length > 0 ? picked : [-1], policy: ROW_POLICY.analysisView,
          rowRange: rowRangeOn(ds.id),
        });
        if (input.ok) { ranRows = input.rowIds; ranView = input.rowRange ? input.data : null; }
        return input.ok ? buildTestRequest(id, input.data, runSelection, runParams) : { ok: false as const, error: input.reason };
      });
      if (request !== seq.current) return;
      // A lazy book's arrival moves the source key: let it commit, then take the key.
      if (active.pending) await afterCommit();
      if (request !== seq.current) return;
      built = resolved.ok ? resolved.value : { ok: false as const, error: resolved.error };
    }
    if (!built.ok) {
      setBusy(false);
      setError(built.error);
      return;
    }
    try {
      const launchKey = stamp.launchKey();
      const result = await runStatsTest(built.request);
      if (request !== seq.current) return;
      const sourceRows = ranRows;
      const described = describeResult(result, built.labels, runParams.alpha, sourceRows);
      stamp.record(launchKey);
      setOutput(described);
      setRanTest(id);
      // Last used is written by a successful run, never by Apply (preset contract P4): what the user set, not the spec-limit prefill.
      void import("./presetAdapter").then((m) => m.recordStatsTestsRun(id, params)).catch(() => undefined);
      if (result.id === "kaplan-meier" && resultSource) {
        setKm(kmRunOf(
          result.data, resultSource, built.labels, runSelection.x, { testId: id, selection: runSelection, survivalGroups: runParams.survivalGroups },
          kaplanMeierColumns(runSelection, runParams),
        ));
      }
      if (result.id === "row-t-tests" && resultSource && built.rowX) {
        const { rowt } = runParams;
        setRowRun(rowTRunOf(
          result.data, resultSource, built.rowX, sourceRows,
          { testId: id, design: rowt.design, variance: rowt.variance, mu: rowt.mu, adjust: rowt.adjust, alpha: runParams.alpha, alternative: runParams.alternative, groupA: runSelection.cols, groupB: rowt.groupB },
          rowsColumns(id, runSelection, rowt),
        ));
      }
      // A save failure must not read as "deleted or undone": the output stays
      // (the test did run) and the book says it could not be saved.
      try {
        setSavedId(publishStatisticalTestResult(resultSource, id, runSelection, runParams, built.labels, described, ranView));
      } catch (e) {
        setSaveError(`This run could not be saved to the Library (${e instanceof Error ? e.message : "unknown error"}); run the test again.`);
      }
    } catch (e) {
      if (request !== seq.current) return;
      setError(e instanceof Error ? e.message : "the test failed");
    } finally {
      if (request === seq.current) setBusy(false);
    }
  }

  const fileStem = `${ranTest}${active ? `_${active.name}` : ""}`.replace(/[^\w.-]+/g, "_");

  async function copy(): Promise<void> {
    if (!output || stale) return;
    const ok = await copyText(outputToTSV(output));
    setStatus(ok ? `copied ${testDef(ranTest).label} results to clipboard` : "clipboard unavailable");
  }

  function exportCsv(): void {
    if (!output || stale) return;
    saveBlob(csvBlob(outputToCSV(output)), `${fileStem}.csv`);
  }

  async function toReport(): Promise<void> {
    if (!output || stale) return;
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
      addReportWithProvenance(title, report, active?.id ?? null);
    } catch (e) {
      toast(`could not add to report — ${e instanceof Error ? e.message : "unknown error"}`, "danger");
    } finally {
      setBusy(false);
    }
  }

  return {
    active,
    inputs: testDef(testId).input === "none" ? null : inputs,
    columns,
    testId,
    def: testDef(testId),
    setTestId: (id) => {
      const pair = pairOnTestChange(columns, testId, id);
      if (pair) setSelRaw((s) => ({ ...s, ...pair }));
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
    savedId,
    saveError,
    ranTest,
    stale,
    km,
    rowRun,
    run,
    copy,
    exportCsv,
    toReport,
  };
}
