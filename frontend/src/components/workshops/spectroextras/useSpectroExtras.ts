// Spectroscopy extras workshop (GAP_AUDIT_9 G21): state hook. The ticked columns of
// the active worksheet's ANALYSIS view (guard #11) against its X column go to the
// three backend tools (routes/spectro_extras.py) on an explicit Run; a result is
// shown only while the spectra and settings still match it, and "Add as worksheet"
// commits through the result-lifecycle contract (store/commitComputedOutput: one
// undo step, no duplicate, stale on a change). The 2-D correlation commits two
// map worksheets (synchronous, asynchronous).
//
// Fail closed: blank / non-finite values and an uneven X (self-deconvolution)
// are refused with a reason; nothing is interpolated or dropped silently.

import { useEffect, useMemo, useRef, useState } from "react";

import { analysisSeries, ROW_POLICY, type AnalysisInputs } from "../../../lib/analysisInputs";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { rowRangeKey } from "../../../lib/rangedView";
import { channelModelingType, isCategorical } from "../../../lib/modeling";
import { xUnitOf } from "../../../lib/transformResample";
import { commitComputedOutput } from "../../../store/commitComputedOutput";
import { useActiveDataset } from "../../../store/useApp";
import { useAnalysisInputs } from "../analysisselection/useAnalysisInputs";
import { seFigures, seOutputs, type SeFigure } from "./spectroOutputs";
import { DEFAULT_SE_OPTIONS, runSpectro, seOptionsOf, seProblem, seRunKey, type SeInput, type SeOptions, type SeResult, type SeTab } from "./spectroRun";

const PRODUCER = { id: "spectro-extras", label: "Spectroscopy extras", version: 1 } as const;

interface Ran { key: string; result: SeResult; input: SeInput }

export interface SpectroExtrasState {
  hasData: boolean;
  inputs: AnalysisInputs;
  columns: { index: number; label: string }[];
  picked: number[];
  toggle: (index: number) => void;
  tab: SeTab;
  setTab: (t: SeTab) => void;
  opts: SeOptions;
  patch: <K extends keyof SeOptions>(section: K, value: Partial<SeOptions[K]>) => void;
  problem: string | null;
  busy: boolean;
  error: string | null;
  result: SeResult | null;
  stale: boolean;
  figures: SeFigure[];
  run: () => Promise<void>;
  canCommit: boolean;
  commit: () => void;
  done: string | null;
}

function continuousColumns(active: ReturnType<typeof useActiveDataset>): number[] {
  if (!active) return [];
  return active.data.labels.map((_, i) => i).filter((i) => !isCategorical(channelModelingType(active, i)));
}

export function useSpectroExtras(): SpectroExtrasState {
  const active = useActiveDataset();
  const [picked, setPicked] = useState<number[]>(() => continuousColumns(active));
  const [tab, setTabState] = useState<SeTab>("fsd");
  const [opts, setOpts] = useState<SeOptions>(DEFAULT_SE_OPTIONS);
  const [ranBy, setRanBy] = useState<Partial<Record<SeTab, Ran>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const seq = useRef(0);
  useEffect(() => () => void seq.current++, []);

  const columns = useMemo(() => (active ? continuousColumns(active).map((index) => ({ index, label: active.data.labels[index] || `column ${index + 1}` })) : []), [active]);
  useEffect(() => {
    seq.current++;
    setPicked(continuousColumns(active));
    setRanBy({}); setError(null); setDone(null); setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  const inputs = useAnalysisInputs({ xKey: null, yKeys: picked, policy: ROW_POLICY.analysisView });
  const input = useMemo<SeInput | null>(() => {
    if (!inputs.ok || !active) return null;
    const x = analysisSeries(inputs, 0).x;
    return {
      x,
      channels: inputs.yKeys.map((index, i) => ({ index, label: columns.find((c) => c.index === index)?.label ?? `column ${index + 1}`, y: analysisSeries(inputs, i).y })),
      xLabel: String(active.data.metadata?.["x_column_name"] ?? "X"),
      xUnit: xUnitOf(active.data),
    };
  }, [inputs, active, columns]);
  // (The row range is part of the run key: a result computed on other rows is not this one.)
  const fingerprint = `${active && !active.pending ? analysisDataFingerprint(active) : "pending"}:${rowRangeKey(inputs.ok ? inputs.rowRange : null)}`;
  const key = seRunKey(tab, fingerprint, picked, opts);
  const problem = seProblem(tab, input, opts);

  const patch: SpectroExtrasState["patch"] = (section, value) => setOpts((o) => ({ ...o, [section]: { ...o[section], ...value } }));
  const toggle = (index: number): void => setPicked((p) => (p.includes(index) ? p.filter((i) => i !== index) : [...p, index].sort((a, b) => a - b)));

  async function run(): Promise<void> {
    if (!input || problem || busy) return;
    const id = ++seq.current;
    setBusy(true); setError(null); setDone(null);
    try {
      const result = await runSpectro(tab, input, opts);
      if (seq.current === id) setRanBy((m) => ({ ...m, [tab]: { key, result, input } }));
    } catch (e) {
      if (seq.current === id) { setRanBy((m) => ({ ...m, [tab]: undefined })); setError(e instanceof Error ? e.message : "spectroscopy run failed"); }
    } finally {
      if (seq.current === id) setBusy(false);
    }
  }

  const ran = ranBy[tab] ?? null;
  const current = ran && ran.key === key ? ran : null;
  const figures = useMemo(() => (current ? seFigures(current.result, current.input) : []), [current]);
  const canCommit = !!current && !!active && !active.pending && !busy;

  function commit(): void {
    if (!current || !active || !canCommit) return;
    const outs = seOutputs(current.result, current.input, active.name.replace(/\.[^.]+$/, ""));
    const notes: string[] = [];
    for (const out of outs) {
      const outcome = commitComputedOutput({
        producer: PRODUCER,
        sources: [{ id: active.id, computedOn: analysisDataFingerprint(active) }],
        settings: { tab, picked, options: seOptionsOf(tab, opts), part: out.name },
        name: out.name, data: out.data, xKey: null, quiet: true,
      });
      if (outcome.kind === "refused") { setError(outcome.reason); return; }
      notes.push(outcome.kind === "existing" ? `"${out.name}" is already added; nothing was duplicated.` : `Added "${out.name}".`);
    }
    setError(null);
    setDone(notes.join(" "));
  }

  return {
    hasData: !!active, inputs, columns, picked, toggle, tab, setTab: (t) => { setTabState(t); setError(null); setDone(null); },
    opts, patch, problem, busy, error, result: current?.result ?? null, stale: !!ran && !current, figures, run, canCommit, commit, done,
  };
}
