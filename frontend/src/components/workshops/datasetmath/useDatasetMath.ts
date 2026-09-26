// Dataset Math workshop — state hook. Combines two loaded datasets pointwise on
// A's x-grid (B interpolated) via /api/aggregate/algebra → calc.aggregate
// .dataset_algebra (golden vs MATLAB). The result lands as a new library dataset.
//
// P2.5: the pick is analyzed LIVE (lib/transformWarnings.analyzeAlgebra — X/Y
// unit mismatch, rows of A outside B's x-range that come out blank) and shown
// before Combine; a unit mismatch disables Combine until the user ticks the
// explicit acknowledgment. The commit goes through lib/transformRun (the same
// path pipeline replay uses), which stamps the warnings into the result's
// metadata and records a replayable `transform` step (B by dataset id).

import { useMemo, useState } from "react";

import { runTransform } from "../../../lib/transformRun";
import { analyzeAlgebra, needsConfirm, type TransformWarning } from "../../../lib/transformWarnings";
import { useApp } from "../../../store/useApp";

export const OPERATIONS: { value: string; label: string }[] = [
  { value: "A+B", label: "A + B" },
  { value: "A-B", label: "A − B" },
  { value: "A*B", label: "A × B" },
  { value: "A/B", label: "A / B" },
  { value: "(A-B)/(A+B)", label: "(A−B) / (A+B)  asymmetry" },
];

export interface DatasetMathState {
  datasets: { id: string; name: string }[];
  idA: string;
  idB: string;
  operation: string;
  interp: string;
  busy: boolean;
  error: string | null;
  /** Live analysis of the current pick (empty when nothing to say). */
  warnings: TransformWarning[];
  /** A unit mismatch is present and not yet acknowledged. */
  blockedByUnits: boolean;
  unitsAcknowledged: boolean;
  /** A pick is a still-loading book: the counts above are from its preview. */
  previewOnly: boolean;
  setUnitsAcknowledged: (ok: boolean) => void;
  setIdA: (id: string) => void;
  setIdB: (id: string) => void;
  setOperation: (op: string) => void;
  setInterp: (m: string) => void;
  compute: () => Promise<void>;
}

export function useDatasetMath(): DatasetMathState {
  const datasets = useApp((s) => s.datasets);
  const activeId = useApp((s) => s.activeId);

  const defaultA = activeId ?? datasets[0]?.id ?? "";
  const [idA, setIdA] = useState(defaultA);
  const [idB, setIdB] = useState(() => datasets.find((d) => d.id !== defaultA)?.id ?? "");
  const [operation, setOperation] = useState("A-B");
  const [interp, setInterp] = useState("pchip");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keyed to the pick it acknowledged: changing A, B or the operation asks again.
  const [ackFor, setAckFor] = useState<string | null>(null);
  const pickKey = `${idA}\u0000${idB}\u0000${operation}`;

  const pickA = datasets.find((d) => d.id === idA);
  const pickB = datasets.find((d) => d.id === idB);
  const warnings = useMemo(
    () => (pickA && pickB && idA !== idB ? analyzeAlgebra(pickA.data, pickB.data, operation, pickA.name, pickB.name) : []),
    [pickA, pickB, idA, idB, operation],
  );
  const unitsAcknowledged = ackFor === pickKey;
  const blockedByUnits = needsConfirm(warnings) && !unitsAcknowledged;

  async function compute(): Promise<void> {
    if (!pickA || !pickB) {
      setError("pick two datasets");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // The review re-checks the RESOLVED data (a pending book's preview can
      // differ in rows, never in units): a unit mismatch commits only when
      // this exact pick was acknowledged.
      const out = await runTransform(
        useApp.getState,
        { op: "algebra", operation, interp, with: { id: pickB.id, name: pickB.name } },
        pickA.id,
        (pv) => Promise.resolve(!needsConfirm(pv.warnings) || ackFor === pickKey),
      );
      if (!out) setError("the units differ — tick “Combine despite the unit mismatch” to continue");
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
    warnings,
    blockedByUnits,
    unitsAcknowledged,
    previewOnly: Boolean(pickA?.pending || pickB?.pending),
    setUnitsAcknowledged: (ok) => setAckFor(ok ? pickKey : null),
    setIdA,
    setIdB,
    setOperation,
    setInterp,
    compute,
  };
}
