// Clustering tab: state hook. Same contract as the PLS / LDA hook: reads the
// Multivariate workshop's ANALYSIS view and its column picks, runs on an
// explicit Run, shows a result only while the data and settings still match it,
// and adds each table as a linked worksheet through commitComputedOutput (one
// undo step, no duplicate, stale on a change). Every unusable input is refused
// with a reason (prepareCluster); skipped rows are counted, never imputed.

import { useEffect, useMemo, useRef, useState } from "react";

import { analysisDataFingerprint } from "../../../../lib/analysisResultFreshness";
import { rowRangeKey } from "../../../../lib/rangedView";
import { commitComputedOutput } from "../../../../store/commitComputedOutput";
import { useMultivarStore } from "../../../../store/multivar";
import { useActiveDataset } from "../../../../store/useApp";
import type { MultivarState } from "../useMultivar";
import { clusterOutputs, type ClusterOutput } from "./clusterOutputs";
import {
  DEFAULT_CLUSTER_OPTIONS, prepareCluster, runCluster,
  type ClusterMeta, type ClusterOptions, type ClusterResult, type ClusterTool,
} from "./clusterRun";

const PRODUCER = { id: "multivar-cluster", label: "Clustering", version: 1 } as const;

interface Ran { key: string; result: ClusterResult; meta: ClusterMeta }

export interface ClusterState {
  tool: ClusterTool;
  setTool: (t: ClusterTool) => void;
  opts: ClusterOptions;
  patch: <K extends ClusterTool>(section: K, value: Partial<ClusterOptions[K]>) => void;
  problem: string | null;
  busy: boolean;
  error: string | null;
  result: ClusterResult | null;
  meta: ClusterMeta | null;
  stale: boolean;
  outputs: ClusterOutput[];
  run: () => Promise<void>;
  canCommit: boolean;
  commit: (key: string) => void;
  done: string | null;
}

export function useCluster(m: MultivarState): ClusterState {
  const active = useActiveDataset();
  const launch = useMultivarStore((s) => s.launch);
  const [tool, setToolState] = useState<ClusterTool>(launch?.cluster ?? "kmeans");
  useEffect(() => { if (launch?.cluster) setToolState(launch.cluster); }, [launch]);
  const [opts, setOpts] = useState<ClusterOptions>(DEFAULT_CLUSTER_OPTIONS);
  const [ranBy, setRanBy] = useState<Partial<Record<ClusterTool, Ran>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const seq = useRef(0);
  useEffect(() => () => void seq.current++, []);
  useEffect(() => {
    seq.current++;
    setOpts(DEFAULT_CLUSTER_OPTIONS); setRanBy({}); setError(null); setDone(null); setBusy(false);
  }, [active?.id]);

  const data = m.inputs.ok ? m.inputs.data : null;
  const rowIds = m.inputs.ok ? m.inputs.rowIds : null;
  // (The row range is part of the run key: a result computed on other rows is not this one.)
  const fingerprint = `${active && !active.pending ? analysisDataFingerprint(active) : "pending"}:${rowRangeKey(m.inputs.ok ? m.inputs.rowRange : null)}`;
  const prepared = useMemo(
    () => {
      const labelOf = (c: number): string => m.columns.find((x) => x.index === c)?.label ?? `column ${c}`;
      return data ? prepareCluster(tool, data, m.selected, rowIds, labelOf, opts) : { problem: "Select a dataset to analyse." };
    },
    [tool, data, m.selected, rowIds, m.columns, opts],
  );
  const problem = prepared.problem;
  const key = JSON.stringify([tool, fingerprint, m.selected, opts[tool]]);

  async function run(): Promise<void> {
    if (prepared.problem !== null || busy) return;
    const { request, meta } = prepared;
    const id = ++seq.current;
    const runTool = tool;
    setBusy(true); setError(null); setDone(null);
    try {
      const result = await runCluster(request);
      if (seq.current === id) setRanBy((r) => ({ ...r, [runTool]: { key, result, meta } }));
    } catch (e) {
      if (seq.current === id) { setRanBy((r) => ({ ...r, [runTool]: undefined })); setError(e instanceof Error ? e.message : "clustering failed"); }
    } finally {
      if (seq.current === id) setBusy(false);
    }
  }

  const ran = ranBy[tool] ?? null;
  const current = ran && ran.key === key ? ran : null;
  const outputs = useMemo(() => (current ? clusterOutputs(current.result, current.meta) : []), [current]);
  const canCommit = !!current && !!active && !active.pending && !busy;

  function commit(outKey: string): void {
    const out = outputs.find((o) => o.key === outKey);
    if (!out || !active || !canCommit) return;
    const outcome = commitComputedOutput({
      producer: PRODUCER,
      sources: [{ id: active.id, computedOn: analysisDataFingerprint(active) }],
      settings: { tool, output: outKey, columns: [...m.selected], options: opts[tool] },
      name: out.name, data: out.data, xKey: null, quiet: true,
    });
    if (outcome.kind === "refused") setError(outcome.reason);
    else setDone(outcome.kind === "existing" ? `"${out.name}" is already added; nothing was duplicated.` : `Added "${out.name}".`);
  }

  const patch: ClusterState["patch"] = (section, value) =>
    setOpts((o) => ({ ...o, [section]: { ...o[section], ...value } }));

  return {
    tool, setTool: (t) => { setToolState(t); setError(null); setDone(null); }, opts, patch, problem, busy, error,
    result: current?.result ?? null, meta: current?.meta ?? null, stale: !!ran && !current, outputs, run, canCommit, commit, done,
  };
}
