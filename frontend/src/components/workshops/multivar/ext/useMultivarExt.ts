// PLS / LDA / spectra PCA tab (GAP_AUDIT_9 G12): state hook. Reads the
// Multivariate workshop's ANALYSIS view (guard #11) and its column picks, runs
// the chosen backend tool on an explicit Run, and shows a result only while the
// data and settings still match it. Each result table is added as a linked
// worksheet through the result-lifecycle contract (store/commitComputedOutput:
// one undo step, no duplicate, stale on a change). Fails closed: every
// unusable input is refused with a reason (prepareExt) and nothing is
// dropped or resampled silently (blank rows are counted and reported).

import { useEffect, useMemo, useRef, useState } from "react";

import { analysisDataFingerprint } from "../../../../lib/analysisResultFreshness";
import { rowRangeKey } from "../../../../lib/rangedView";
import { useMultivarStore } from "../../../../store/multivar";
import { commitComputedOutput } from "../../../../store/commitComputedOutput";
import { useActiveDataset } from "../../../../store/useApp";
import type { MultivarState } from "../useMultivar";
import { extFigures, extOutputs, type ExtFigure, type ExtOutput } from "./multivarExtOutputs";
import { DEFAULT_EXT_OPTIONS, prepareExt, runExt, type ExtMeta, type ExtOptions, type ExtResult, type ExtTool } from "./multivarExtRun";

const PRODUCER = { id: "multivar-ext", label: "PLS / LDA / spectra PCA", version: 1 } as const;

interface Ran { key: string; result: ExtResult; meta: ExtMeta }

export interface MultivarExtState {
  tool: ExtTool;
  setTool: (t: ExtTool) => void;
  opts: ExtOptions;
  patch: <K extends keyof ExtOptions>(section: K, value: Partial<ExtOptions[K]>) => void;
  problem: string | null;
  busy: boolean;
  error: string | null;
  result: ExtResult | null;
  meta: ExtMeta | null;
  stale: boolean;
  figures: ExtFigure[];
  outputs: ExtOutput[];
  run: () => Promise<void>;
  canCommit: boolean;
  commit: (key: string) => void;
  done: string | null;
}

export function useMultivarExt(m: MultivarState): MultivarExtState {
  const active = useActiveDataset();
  const launch = useMultivarStore((s) => s.launch);
  const [tool, setToolState] = useState<ExtTool>(launch?.tool ?? "pls");
  useEffect(() => { if (launch?.tool) setToolState(launch.tool); }, [launch]);
  const [opts, setOpts] = useState<ExtOptions>(DEFAULT_EXT_OPTIONS);
  const [ranBy, setRanBy] = useState<Partial<Record<ExtTool, Ran>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const seq = useRef(0);
  useEffect(() => () => void seq.current++, []);
  useEffect(() => {
    seq.current++;
    setOpts(DEFAULT_EXT_OPTIONS); setRanBy({}); setError(null); setDone(null); setBusy(false);
  }, [active?.id]);

  const data = m.inputs.ok ? m.inputs.data : null;
  const rowIds = m.inputs.ok ? m.inputs.rowIds : null;
  const labelOf = (c: number): string => m.columns.find((x) => x.index === c)?.label ?? `column ${c}`;
  // (The row range is part of the run key: a result computed on other rows is not this one.)
  const fingerprint = `${active && !active.pending ? analysisDataFingerprint(active) : "pending"}:${rowRangeKey(m.inputs.ok ? m.inputs.rowRange : null)}`;
  const prepared = useMemo(
    () => (data ? prepareExt(tool, data, m.selected, rowIds, labelOf, opts) : { problem: "Select a dataset to analyse." }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tool, data, m.selected, rowIds, m.columns, opts],
  );
  const problem = prepared.problem;
  const key = JSON.stringify([tool, fingerprint, m.selected, tool === "pls" ? opts.pls : tool === "lda" ? opts.lda : opts.spectra]);

  async function run(): Promise<void> {
    if (prepared.problem !== null || busy) return;
    const { request, meta } = prepared;
    const id = ++seq.current;
    const runTool = tool;
    setBusy(true); setError(null); setDone(null);
    try {
      const result = await runExt(request);
      if (seq.current === id) setRanBy((r) => ({ ...r, [runTool]: { key, result, meta } }));
    } catch (e) {
      if (seq.current === id) { setRanBy((r) => ({ ...r, [runTool]: undefined })); setError(e instanceof Error ? e.message : "analysis failed"); }
    } finally {
      if (seq.current === id) setBusy(false);
    }
  }

  const ran = ranBy[tool] ?? null;
  const current = ran && ran.key === key ? ran : null;
  const figures = useMemo(() => (current ? extFigures(current.result, current.meta) : []), [current]);
  const outputs = useMemo(() => (current ? extOutputs(current.result, current.meta) : []), [current]);
  const canCommit = !!current && !!active && !active.pending && !busy;

  function commit(outKey: string): void {
    const out = outputs.find((o) => o.key === outKey);
    if (!out || !active || !canCommit) return;
    const outcome = commitComputedOutput({
      producer: PRODUCER,
      sources: [{ id: active.id, computedOn: analysisDataFingerprint(active) }],
      settings: { tool, output: outKey, columns: [...m.selected], options: tool === "pls" ? opts.pls : tool === "lda" ? opts.lda : opts.spectra },
      name: out.name, data: out.data, xKey: null, quiet: true,
    });
    if (outcome.kind === "refused") setError(outcome.reason);
    else setDone(outcome.kind === "existing" ? `"${out.name}" is already added; nothing was duplicated.` : `Added "${out.name}".`);
  }

  const patch: MultivarExtState["patch"] = (section, value) =>
    setOpts((o) => ({ ...o, [section]: { ...o[section], ...value } }));

  return {
    tool, setTool: (t) => { setToolState(t); setError(null); setDone(null); }, opts, patch, problem, busy, error,
    result: current?.result ?? null, meta: current?.meta ?? null, stale: !!ran && !current, figures, outputs, run, canCommit, commit, done,
  };
}
