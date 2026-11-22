// Spin asymmetry — state hook for the Reflectivity workshop's "Spin asym."
// mode. Picks the R++ and R-- channels (dataset + column + its dR), pairs them
// on one Q grid and lands SA(Q) with dSA in the library (./spinAsymmetry holds
// every rule; this file only sequences it). A newer run or unmount makes an
// older one write nothing.

import { useEffect, useRef, useState } from "react";

import { spinAsymmetry } from "../../../lib/api/reductions";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { commitComputedOutput } from "../../../store/commitComputedOutput";
import { useActiveDataset, useApp } from "../../../store/useApp";
import type { Dataset } from "../../../lib/types";
import { useReopenSeed } from "../resultcommit/useReopenSession";
import { useReplaceLayoutBlock } from "../resultcommit/useReplaceLayoutBlock";
import { asymmetryStruct, defaultChannels, pairChannels, readChannel, spinRequest } from "./spinAsymmetry";

const SPIN_ASYMMETRY_PRODUCER = { id: "spin-asymmetry", label: "Spin asymmetry", version: 1 } as const;

export interface ChannelPick {
  id: string;
  col: number;
  errCol: number | null;
}

/** A recorded channel pick of `ds`, or null when it no longer fits (a column index out of range). */
function recordedPick(ds: Dataset | undefined, value: unknown): ChannelPick | null {
  if (!ds || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const { col, errCol } = value as { col?: unknown; errCol?: unknown };
  const n = ds.data.labels.length;
  const ok = (c: unknown): c is number => typeof c === "number" && Number.isInteger(c) && c >= 0 && c < n;
  if (!ok(col) || (errCol !== null && !ok(errCol))) return null;
  return { id: ds.id, col, errCol: errCol === null ? null : (errCol as number) };
}

export function useSpinAsymmetry() {
  const active = useActiveDataset();
  const datasets = useApp((s) => s.datasets);
  const resolveDataset = useApp((s) => s.resolveDataset);
  // Opened from a committed result (lane RO2): R++ is its first source, R-- the
  // one its settings name; a pick whose column no longer exists falls back to
  // the default pick rather than guessing.
  const seed = useReopenSeed(SPIN_ASYMMETRY_PRODUCER.id, active?.id);

  const pickFor = (id: string): ChannelPick => {
    const ds = datasets.find((d) => d.id === id);
    return { id, ...(ds ? defaultChannels(ds) : { col: 0, errCol: null }) };
  };
  const seededPp = seed && recordedPick(datasets.find((d) => d.id === seed.sourceIds[0]), seed.settings["pp"]);
  const [pp, setPp] = useState<ChannelPick>(() => seededPp || pickFor(active?.id ?? datasets[0]?.id ?? ""));
  const [mm, setMm] = useState<ChannelPick>(() => {
    const mmId = seed && (typeof seed.settings["mmId"] === "string" ? seed.settings["mmId"] : seed.sourceIds[1] ?? seed.sourceIds[0]);
    return (seed && recordedPick(datasets.find((d) => d.id === mmId), seed.settings["mm"]))
      || pickFor(datasets.find((d) => d.id !== pp.id)?.id ?? "");
  });
  // A recorded pick that no longer fits its worksheet is NOT guessed at: the
  // channels are back to the defaults, the commit adds a new output (Replace is
  // off) until the user has picked them.
  const [seedProblem, setSeedProblem] = useState<string | null>(() => (seed && (!seededPp || recordedPick(
    datasets.find((d) => d.id === (typeof seed.settings["mmId"] === "string" ? seed.settings["mmId"] : seed.sourceIds[1] ?? seed.sourceIds[0])), seed.settings["mm"]) === null)
    ? "The recorded R++ / R-- columns no longer fit their worksheets, so the channels are back to the defaults. Pick them; until then a commit adds a new output." : null));
  useReplaceLayoutBlock(SPIN_ASYMMETRY_PRODUCER.id, pp.id, null, seedProblem);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const seq = useRef(0);
  useEffect(() => () => void seq.current++, []);

  const known = (p: ChannelPick) => datasets.some((d) => d.id === p.id);
  const block = !known(pp) || !known(mm)
    ? "pick an R++ and an R-- dataset"
    : pp.id === mm.id && pp.col === mm.col ? "R++ and R-- are the same column" : null;

  const compute = async (): Promise<void> => {
    if (block || busy) return;
    const id = ++seq.current;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const [dpp, dmm] = await Promise.all([resolveDataset(pp.id), resolveDataset(mm.id)]);
      if (!dpp || !dmm) throw new Error("a picked dataset is no longer available");
      const pair = pairChannels(readChannel(dpp, pp.col, pp.errCol), readChannel(dmm, mm.col, mm.errCol));
      if ("error" in pair) throw new Error(pair.error);
      const { body, rows } = spinRequest(pair);
      if (rows.length === 0) throw new Error("no Q point has a finite R++ and R--");
      const res = await spinAsymmetry(body);
      if (seq.current !== id) return;
      const { data, errorRoles } = asymmetryStruct(pair.q, rows, res, {
        pp: { dataset: dpp, col: pp.col }, mm: { dataset: dmm, col: mm.col },
      });
      const name = `Spin asymmetry (${dpp.name} / ${dmm.name})`;
      // One undo step, no duplicate on a repeat run, stale when EITHER channel's
      // worksheet changes (store/analysisOutputCommit.ts).
      const outcome = commitComputedOutput({
        producer: SPIN_ASYMMETRY_PRODUCER,
        sources: [
          { id: dpp.id, computedOn: analysisDataFingerprint(dpp) },
          { id: dmm.id, computedOn: analysisDataFingerprint(dmm) },
        ],
        settings: { pp: { col: pp.col, errCol: pp.errCol }, mm: { col: mm.col, errCol: mm.errCol }, mmId: dmm.id },
        name, data, errorRoles,
      });
      if (outcome.kind === "refused") throw new Error(outcome.reason);
      setDone(outcome.kind === "existing"
        ? `"${name}" is already added; nothing was duplicated.`
        : `${outcome.kind === "replaced" ? "Replaced with" : "Added"} "${name}": ${res.n_valid} of ${pair.q.length} Q points valid.`);
    } catch (e) {
      if (seq.current !== id) return;
      setError(e instanceof Error ? e.message : "spin asymmetry failed");
    } finally {
      if (seq.current === id) setBusy(false);
    }
  };

  return {
    datasets, pp, mm, busy, error, done, block, compute, seedProblem,
    setPp: (p: Partial<ChannelPick>) => { setSeedProblem(null); setPp((c) => (p.id && p.id !== c.id ? pickFor(p.id) : { ...c, ...p })); },
    setMm: (p: Partial<ChannelPick>) => { setSeedProblem(null); setMm((c) => (p.id && p.id !== c.id ? pickFor(p.id) : { ...c, ...p })); },
  };
}

export type SpinAsymmetryState = ReturnType<typeof useSpinAsymmetry>;
