// Spin asymmetry — state hook for the Reflectivity workshop's "Spin asym."
// mode. Picks the R++ and R-- channels (dataset + column + its dR), pairs them
// on one Q grid and lands SA(Q) with dSA in the library (./spinAsymmetry holds
// every rule; this file only sequences it). A newer run or unmount makes an
// older one write nothing.

import { useEffect, useRef, useState } from "react";

import { spinAsymmetry } from "../../../lib/api/reductions";
import { nextDatasetId, useActiveDataset, useApp } from "../../../store/useApp";
import { asymmetryStruct, defaultChannels, pairChannels, readChannel, spinRequest } from "./spinAsymmetry";

export interface ChannelPick {
  id: string;
  col: number;
  errCol: number | null;
}

export function useSpinAsymmetry() {
  const active = useActiveDataset();
  const datasets = useApp((s) => s.datasets);
  const resolveDataset = useApp((s) => s.resolveDataset);
  const addDataset = useApp((s) => s.addDataset);

  const pickFor = (id: string): ChannelPick => {
    const ds = datasets.find((d) => d.id === id);
    return { id, ...(ds ? defaultChannels(ds) : { col: 0, errCol: null }) };
  };
  const [pp, setPp] = useState<ChannelPick>(() => pickFor(active?.id ?? datasets[0]?.id ?? ""));
  const [mm, setMm] = useState<ChannelPick>(() => pickFor(datasets.find((d) => d.id !== pp.id)?.id ?? ""));
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
      addDataset({ id: nextDatasetId(), name, data, errorRoles });
      setDone(`Added "${name}": ${res.n_valid} of ${pair.q.length} Q points valid.`);
    } catch (e) {
      if (seq.current !== id) return;
      setError(e instanceof Error ? e.message : "spin asymmetry failed");
    } finally {
      if (seq.current === id) setBusy(false);
    }
  };

  return {
    datasets, pp, mm, busy, error, done, block, compute,
    setPp: (p: Partial<ChannelPick>) => setPp((c) => (p.id && p.id !== c.id ? pickFor(p.id) : { ...c, ...p })),
    setMm: (p: Partial<ChannelPick>) => setMm((c) => (p.id && p.id !== c.id ? pickFor(p.id) : { ...c, ...p })),
  };
}

export type SpinAsymmetryState = ReturnType<typeof useSpinAsymmetry>;
