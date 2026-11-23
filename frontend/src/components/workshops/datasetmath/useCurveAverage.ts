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

import { reviewTransform } from "../../../lib/transformRun";
import type { AverageGrid, AverageParams } from "../../../lib/transformAverage";
import { commitTransformOutput } from "../../../store/commitTransformOutput";
import { useApp } from "../../../store/useApp";
import { useWorkbenchCommit } from "../workbench/useWorkbenchCommit";
import { isAbortError } from "../workbench/useWorkbenchPreview";

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
  /** Stop an Average in flight: nothing is created. */
  cancel: () => void;
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
  // Cancel and unmount (Close) abort the pending Average: it commits nothing.
  const committing = useWorkbenchCommit();
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
    await committing.run(async (signal) => {
      try {
        // Through the shared commit contract: one undo step with its Library result,
        // and averaging the same curves again adds nothing.
        const out = await commitTransformOutput(useApp.getState, p, live[0], (pv) => reviewTransform(pv, signal), signal);
        if (signal.aborted) return;
        setUnitRefused(false);
        if (out?.existing) setError(`Already added as “${out.name}”; nothing was duplicated. Undo or delete it to average again.`);
      } catch (e) {
        if (signal.aborted || isAbortError(e)) return;
        const msg = e instanceof Error ? e.message : "averaging failed";
        setUnitRefused(/units differ/.test(msg));
        setError(msg);
      }
    });
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
    busy: committing.busy,
    error,
    cancel: committing.abort,
    blocked,
    compute,
  };
}
