// Dataset Math workshop — state hook. Combines two loaded datasets pointwise on
// A's x-grid (B interpolated) via /api/aggregate/algebra → calc.aggregate
// .dataset_algebra (golden vs MATLAB). The result lands as a new library dataset.

import { useState } from "react";

import { datasetAlgebra } from "../../../lib/api";
import { useApp } from "../../../store/useApp";

export const OPERATIONS: { value: string; label: string }[] = [
  { value: "A+B", label: "A + B" },
  { value: "A-B", label: "A − B" },
  { value: "A*B", label: "A × B" },
  { value: "A/B", label: "A / B" },
  { value: "(A-B)/(A+B)", label: "(A−B) / (A+B)  asymmetry" },
];

const SYMBOL: Record<string, string> = {
  "A+B": "+", "A-B": "−", "A*B": "×", "A/B": "/", "(A-B)/(A+B)": "asym",
};

let _seq = 0;

export interface DatasetMathState {
  datasets: { id: string; name: string }[];
  idA: string;
  idB: string;
  operation: string;
  interp: string;
  busy: boolean;
  error: string | null;
  setIdA: (id: string) => void;
  setIdB: (id: string) => void;
  setOperation: (op: string) => void;
  setInterp: (m: string) => void;
  compute: () => Promise<void>;
}

const stem = (name: string): string => name.replace(/\.[^.]+$/, "");

export function useDatasetMath(): DatasetMathState {
  const datasets = useApp((s) => s.datasets);
  const activeId = useApp((s) => s.activeId);
  const addDataset = useApp((s) => s.addDataset);
  const setStatus = useApp((s) => s.setStatus);

  const defaultA = activeId ?? datasets[0]?.id ?? "";
  const [idA, setIdA] = useState(defaultA);
  const [idB, setIdB] = useState(() => datasets.find((d) => d.id !== defaultA)?.id ?? "");
  const [operation, setOperation] = useState("A-B");
  const [interp, setInterp] = useState("pchip");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function compute(): Promise<void> {
    const pickA = datasets.find((d) => d.id === idA);
    const pickB = datasets.find((d) => d.id === idB);
    if (!pickA || !pickB) {
      setError("pick two datasets");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // #38 deferred edge: either pick can be a never-activated, still-
      // pending Origin book — resolve both to full data before combining.
      const [a, b] = await Promise.all([
        useApp.getState().resolveDataset(idA),
        useApp.getState().resolveDataset(idB),
      ]);
      if (!a || !b) {
        setError("pick two datasets");
        return;
      }
      const data = await datasetAlgebra({
        dataset_a: a.data,
        dataset_b: b.data,
        operation,
        interp_method: interp,
      });
      const name = `${stem(a.name)} ${SYMBOL[operation] ?? operation} ${stem(b.name)}`;
      addDataset({ id: `math-${++_seq}`, name, data });
      setStatus(`combined ${a.name} ${SYMBOL[operation] ?? operation} ${b.name}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "dataset math failed");
    } finally {
      setBusy(false);
    }
  }

  return {
    datasets: datasets.map((d) => ({ id: d.id, name: d.name })),
    idA,
    idB,
    operation,
    interp,
    busy,
    error,
    setIdA,
    setIdB,
    setOperation,
    setInterp,
    compute,
  };
}
