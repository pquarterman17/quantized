// Dataset Math — "Average N datasets" state (origin gap audit 2 #9, Origin's
// "Average Multiple Curves"). Pick N ≥ 2 datasets, the y column they share,
// and a common grid (the union of their x, or a set step over their overlap);
// the commit is ONE recorded `average` transform (lib/transformAverage.ts via
// lib/transformRun), so it is undoable, replayable, and its output is a linked
// derived dataset with SEM bound as the mean's error.
//
// A unit disagreement between the curves is refused by the backend; the
// message is shown and the user may tick "average despite the unit mismatch",
// after which the review dialog still asks with a danger confirm.

import { useMemo, useState } from "react";

import { reviewTransform, runTransform } from "../../../lib/transformRun";
import type { AverageGrid, AverageParams } from "../../../lib/transformAverage";
import { useApp } from "../../../store/useApp";

export interface CurveAverageState {
  datasets: { id: string; name: string }[];
  picked: string[];
  toggle: (id: string) => void;
  /** Column names every picked dataset has (numeric). */
  sharedColumns: string[];
  channel: string;
  setChannel: (c: string) => void;
  grid: AverageGrid;
  setGrid: (g: AverageGrid) => void;
  step: string;
  setStep: (s: string) => void;
  sortUnsorted: boolean;
  setSortUnsorted: (v: boolean) => void;
  allowUnits: boolean;
  setAllowUnits: (v: boolean) => void;
  /** The last refusal was a unit disagreement (offer the acknowledgment). */
  unitRefused: boolean;
  busy: boolean;
  error: string | null;
  /** Why Average is disabled, or null when it can run. */
  blocked: string | null;
  compute: () => Promise<void>;
}

function numericLabels(d: { data: { labels: string[]; cat_levels?: Record<string, unknown> | null } }): string[] {
  const cats = d.data.cat_levels ?? {};
  return d.data.labels.filter((_, i) => !(String(i) in cats));
}

export function useCurveAverage(): CurveAverageState {
  const all = useApp((s) => s.datasets);
  const selectedIds = useApp((s) => s.selectedIds);
  const activeId = useApp((s) => s.activeId);
  // Seeded once: the Library selection (2+), else the active dataset.
  const [picked, setPicked] = useState<string[]>(() => {
    const sel = selectedIds.filter((id) => all.some((d) => d.id === id));
    return sel.length >= 2 ? sel : activeId ? [activeId] : [];
  });
  const [channel, setChannel] = useState("");
  const [grid, setGrid] = useState<AverageGrid>("union");
  const [step, setStep] = useState("");
  const [sortUnsorted, setSortUnsorted] = useState(false);
  const [allowUnits, setAllowUnits] = useState(false);
  const [unitRefused, setUnitRefused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const live = picked.filter((id) => all.some((d) => d.id === id));
  const sharedColumns = useMemo(() => {
    const sets = live.map((id) => numericLabels(all.find((d) => d.id === id)!));
    if (!sets.length) return [];
    return sets[0].filter((l, i, a) => a.indexOf(l) === i && sets.every((s) => s.includes(l)));
  }, [live, all]);
  // A column no longer shared falls back to "each one's first column".
  const effChannel = sharedColumns.includes(channel) ? channel : "";
  const stepNum = Number(step);
  const blocked =
    live.length < 2
      ? "Pick at least two datasets."
      : grid === "step" && !(Number.isFinite(stepNum) && stepNum > 0)
        ? "Enter a positive step."
        : null;

  async function compute(): Promise<void> {
    if (blocked) return;
    setBusy(true);
    setError(null);
    const p: AverageParams = {
      op: "average",
      channel: effChannel,
      grid,
      ...(grid === "step" ? { step: stepNum } : {}),
      sortUnsorted,
      ...(allowUnits ? { allowUnitMismatch: true } : {}),
      with: live.slice(1).map((id) => ({ id, name: all.find((d) => d.id === id)?.name ?? id })),
    };
    try {
      await runTransform(useApp.getState, p, live[0], reviewTransform);
      setUnitRefused(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "averaging failed";
      setUnitRefused(/units differ/.test(msg));
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return {
    datasets: all.map((d) => ({ id: d.id, name: d.name })),
    picked: live,
    toggle: (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])),
    sharedColumns,
    channel: effChannel,
    setChannel,
    grid,
    setGrid,
    step,
    setStep,
    sortUnsorted,
    setSortUnsorted,
    allowUnits,
    setAllowUnits,
    unitRefused,
    busy,
    error,
    blocked,
    compute,
  };
}
