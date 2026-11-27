// Probability calculator: state hook. One value (x and/or p) answers live; a
// worksheet column is evaluated and committed as a NEW linked worksheet through
// the shared result contract (one undo step, no duplicate on a repeat, marked out
// of date when the source column's worksheet changes). The source is never edited.

import { useEffect, useMemo, useState } from "react";

import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { statsDistributions, statsProbability, type DistInfo, type ProbabilityResult } from "../../../lib/api/statsPower";
import type { DataStruct } from "../../../lib/types";
import { commitComputedOutput } from "../../../store/commitComputedOutput";
import { useActiveDataset } from "../../../store/useApp";
import { pickColumns, pickLabel, useLoadColumns, validPick } from "../analysisextras/columnPicks";
import { isAbortError } from "../workbench/useWorkbenchPreview";
import { useWorkbenchCommit } from "../workbench/useWorkbenchCommit";

export const PROB_PRODUCER = { id: "prob-calc", label: "Probability calculator", version: 1 } as const;

export type Holds = "x" | "p";

/** The worksheet a column evaluation becomes: the input column is the X axis. */
export function probabilityWorksheet(r: ProbabilityResult, holds: Holds, xLabel: string): DataStruct {
  const input = (holds === "x" ? r.x : r.p) ?? [];
  const cols: [string, (number | null)[] | undefined][] = holds === "x"
    ? [[r.discrete ? "pmf" : "pdf", r.pdf], ["cdf", r.cdf], ["survival", r.sf]]
    : [["quantile", r.quantile]];
  const nan = (v: number | null | undefined): number => (typeof v === "number" ? v : NaN);
  return {
    time: input.map(nan),
    values: input.map((_v, i) => cols.map(([, c]) => nan(c?.[i]))),
    labels: cols.map(([l]) => l),
    units: cols.map(() => ""),
    metadata: { x_column_name: xLabel, source: "probability-calculator" },
  };
}

export function useProbability() {
  const active = useActiveDataset();
  const load = useLoadColumns();
  const committing = useWorkbenchCommit();
  const [dists, setDists] = useState<DistInfo[]>([]);
  const [dist, setDist] = useState("normal");
  const [params, setParams] = useState<Record<string, number | undefined>>({});
  const [x, setX] = useState<number | undefined>(0);
  const [p, setP] = useState<number | undefined>(0.975);
  const [source, setSource] = useState<"value" | "column">("value");
  const [holds, setHolds] = useState<Holds>("x");
  const [pick, setPick] = useState(-1);
  const [answer, setAnswer] = useState<{ key: string; result?: ProbabilityResult; error?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    statsDistributions().then((d) => { if (live) setDists(d); }, () => { if (live) setError("could not load the distribution list"); });
    return () => { live = false; };
  }, []);

  const info = dists.find((d) => d.id === dist);
  const values = info ? info.params.map((name, i) => params[`${dist}.${name}`] ?? info.defaults[i]) : [];
  const columns = useMemo(() => pickColumns(active ?? null), [active]);
  const column = validPick(columns, pick, columns[0]?.index ?? -1);

  const body = info && values.every((v) => v !== undefined && Number.isFinite(v))
    ? { dist, params: Object.fromEntries(info.params.map((n, i) => [n, values[i]!])) }
    : null;
  const key = body && source === "value" ? JSON.stringify({ ...body, x, p }) : "";
  useEffect(() => {
    if (!key) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      const req = JSON.parse(key) as { dist: string; params: Record<string, number>; x?: number; p?: number };
      const { x: xv, p: pv, ...rest } = req;
      statsProbability({ ...rest, ...(xv !== undefined ? { x: [xv] } : {}), ...(pv !== undefined ? { p: [pv] } : {}) }, ctl.signal).then(
        (result) => setAnswer({ key, result }),
        (e: unknown) => { if (!ctl.signal.aborted && !isAbortError(e)) setAnswer({ key, error: e instanceof Error ? e.message : "the calculation failed" }); },
      );
    }, 150);
    return () => { clearTimeout(timer); ctl.abort(); };
  }, [key]);
  const current = answer && answer.key === key ? answer : null;
  const valueNeeded = source === "value" && x === undefined && p === undefined ? "Enter x or p." : null;

  const addColumn = async (): Promise<void> => {
    setError(null);
    if (!active || !body) return;
    await committing.run(async (signal) => {
      try {
        const { columns: cols } = await load(active.id, [column]);
        const input = cols[0]!;
        const result = await statsProbability({ ...body, ...(holds === "x" ? { x: input } : { p: input }) }, signal);
        signal.throwIfAborted();
        const label = pickLabel(columns, column);
        const name = `${result.label}(${info!.params.map((n, i) => `${n}=${values[i]}`).join(", ")}) ${holds === "x" ? "of" : "quantile of"} ${label} - ${active.name}`;
        const o = commitComputedOutput({
          producer: PROB_PRODUCER,
          sources: [{ id: active.id, computedOn: analysisDataFingerprint(active) }],
          settings: { dist, params: body.params, holds, pick: column, pickLabel: label },
          name,
          data: probabilityWorksheet(result, holds, label),
          xKey: column < 0 ? null : column,
          status: `added ${name}`,
        });
        if (o.kind === "refused") setError(o.reason);
      } catch (e) {
        if (signal.aborted || isAbortError(e)) return;
        setError(e instanceof Error ? e.message : "the calculation failed");
      }
    });
  };

  return {
    dists, dist, info, values,
    setDist: (d: string) => { setDist(d); setAnswer(null); },
    setParam: (name: string, v: number | undefined) => setParams((s) => ({ ...s, [`${dist}.${name}`]: v })),
    x, setX, p, setP,
    source, setSource, holds, setHolds,
    hasActive: !!active, columns, column, setPick,
    result: current?.result ?? null,
    problem: valueNeeded ?? current?.error ?? error,
    busy: committing.busy,
    addColumn,
  };
}
