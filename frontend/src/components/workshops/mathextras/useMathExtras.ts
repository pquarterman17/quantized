// Math extras workshop — state hook. Eight jobs behind one mode list. The areas
// and the solver answer with a result card; the interpolation, resampling and
// correlation jobs also commit a NEW derived dataset through the shared result
// contract (store/commitComputedOutput: one undo step, no duplicate on a repeat,
// marked out of date when a source changes, inputs and settings recorded; the
// sources are never edited). The work is in mathExtrasRun.

import { useMemo, useState } from "react";

import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { commitComputedOutput } from "../../../store/commitComputedOutput";
import type { Dataset } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { pickColumns, pickLabel, useLoadColumns, validPick, type PickColumn } from "../analysisextras/columnPicks";
import { useReopenSeed } from "../resultcommit/useReopenSession";
import { isAbortError } from "../workbench/useWorkbenchPreview";
import { useWorkbenchCommit } from "../workbench/useWorkbenchCommit";
import { emptyForm, inputOf, type MathForm, type MathInput, type MathMode } from "./mathExtrasForm";
import { runMath, type Card } from "./mathExtrasRun";
import { formSettings, mathSeed, type MathSeed } from "./mathExtrasSeed";

// Version 2 records the mode, the form fields it reads and the picked columns by name, which "Open in Math extras" needs.
export const MATH_EXTRAS_PRODUCER = { id: "math-extras", label: "Math extras", version: 2 } as const;

const isMap = (d: { metadata?: Record<string, unknown> } | undefined): boolean => d?.metadata?.["is2D"] === true;

/** Why a reopened result's recorded settings cannot be restored (null: they can). The recorded
 *  columns must still be where they were, by name. */
function seedCheck(seed: MathSeed | null, active: Dataset | null, datasets: readonly Dataset[]): string | null {
  if (!seed) return "Its recorded settings are incomplete, so they are not restored.";
  const labels = (ds: Dataset | undefined, picks: number[]) => picks.map((p) => pickLabel(pickColumns(ds ?? null), p));
  if (labels(active ?? undefined, seed.picks).some((l, i) => l !== seed.pickLabels[i])) {
    return "The columns it used have moved or been renamed, so its settings are not restored: set them again.";
  }
  if (seed.query) {
    const q = datasets.find((d) => d.id === seed.query!.id);
    if (!q) return "The worksheet its query points came from no longer exists, so its settings are not restored: set them again.";
    if (labels(q, seed.query.picks).some((l, i) => l !== seed.query!.labels[i])) {
      return "The columns its query points came from have moved or been renamed, so its settings are not restored: set them again.";
    }
  }
  return null;
}

export interface MathExtrasState {
  mode: MathMode;
  setMode: (m: MathMode) => void;
  input: MathInput;
  hasActive: boolean;
  activeIsMap: boolean;
  columns: PickColumn[];
  picks: number[];
  setPick: (slot: number, index: number) => void;
  form: MathForm;
  setForm: (patch: Partial<MathForm>) => void;
  /** The maps that can be the second map of a correlation (every map but the active one). */
  otherMaps: { id: string; name: string }[];
  otherId: string;
  setOtherId: (id: string) => void;
  /** Scattered interpolation: the worksheets query points can be read from, the chosen one and its column picks. */
  queryWorksheets: { id: string; name: string }[];
  queryId: string;
  setQueryId: (id: string) => void;
  queryColumns: PickColumn[];
  queryPicks: number[];
  setQueryPick: (slot: number, index: number) => void;
  /** Why a reopened result's recorded settings (or part of them) were not restored, else null. */
  seedNote: string | null;
  busy: boolean;
  error: string | null;
  card: Card | null;
  cancel: () => void;
  run: () => Promise<void>;
}

export function useMathExtras(): MathExtrasState {
  const active = useActiveDataset();
  const datasets = useApp((s) => s.datasets);
  const resolveDataset = useApp((s) => s.resolveDataset);
  const load = useLoadColumns();
  const committing = useWorkbenchCommit();
  // "Open in Math extras": start from the recorded job, options and columns. The columns are
  // proven to still be where they were (by name) before they are restored.
  const reopened = useReopenSeed(MATH_EXTRAS_PRODUCER.id, active?.id);
  const seed = useMemo(() => (reopened ? mathSeed(reopened.settings) : null), [reopened]);
  // Checked once, at mount: a note the user can act on, not a live nag.
  const [seedProblem] = useState(() => (reopened ? seedCheck(seed, active ?? null, datasets) : null));
  const [mode, setModeState] = useState<MathMode>(seed && !seedProblem ? seed.mode : "polygon-area");
  const [userPicks, setUserPicks] = useState<number[]>(seed && !seedProblem ? seed.picks : [-1, 0, 1, 2]);
  const [form, setFormState] = useState(() => (seed && !seedProblem ? seed.form : emptyForm()));
  const [otherId, setOtherId] = useState(() => (seed && !seedProblem && seed.mode === "correlate" ? (reopened?.sourceIds[1] ?? "") : ""));
  const [queryId, setQueryId] = useState(seed && !seedProblem ? (seed.query?.id ?? "") : "");
  const [queryPicks, setQueryPicks] = useState<number[]>(seed && !seedProblem ? (seed.query?.picks ?? [-1, 0, 1]) : [-1, 0, 1]);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<{ mode: MathMode; card: Card } | null>(null);

  const columns = useMemo(() => pickColumns(active ?? null), [active]);
  const picks = userPicks.map((p, i) => validPick(columns, p, columns[Math.min(i + 1, columns.length - 1)]?.index ?? -1));
  const otherMaps = datasets.filter((d) => isMap(d.data) && d.id !== active?.id).map((d) => ({ id: d.id, name: d.name }));
  const other = datasets.find((d) => d.id === (otherId || otherMaps[0]?.id)) ?? null;
  const queryDs = datasets.find((d) => d.id === (queryId || active?.id)) ?? null;
  const queryColumns = useMemo(() => pickColumns(queryDs), [queryDs]);
  const qPicks = queryPicks.map((p, i) => validPick(queryColumns, p, queryColumns[Math.min(i + 1, queryColumns.length - 1)]?.index ?? -1));
  const query = form.queriesFrom === "sheet" && queryDs ? { ds: queryDs, picks: qPicks } : null;

  const run = async (): Promise<void> => {
    setError(null);
    await committing.run(async (signal) => {
      try {
        const out = await runMath({ mode, form, active: active ?? null, columns, picks, other, query, load, resolve: resolveDataset, signal });
        signal.throwIfAborted();
        setShown({ mode, card: out.card });
        if (!out.output) return;
        const o = commitComputedOutput({
          producer: MATH_EXTRAS_PRODUCER,
          sources: out.output.sources.map((d) => ({ id: d.id, computedOn: analysisDataFingerprint(d) })),
          settings: {
            ...out.output.settings, mode, form: formSettings(mode, form), picks, pickLabels: picks.map((p) => pickLabel(columns, p)),
          },
          name: out.output.name,
          data: out.output.data,
          status: `created ${out.output.name}`,
        });
        if (o.kind === "refused") setError(o.reason);
      } catch (e) {
        if (signal.aborted || isAbortError(e)) return;
        setShown(null);
        setError(e instanceof Error ? e.message : "the operation failed");
      }
    });
  };

  return {
    mode,
    setMode: (m) => { setModeState(m); setError(null); },
    input: inputOf(mode),
    hasActive: !!active,
    activeIsMap: isMap(active?.data),
    columns,
    picks,
    setPick: (slot, index) => { setUserPicks(picks.map((v, i) => (i === slot ? index : v))); setShown(null); },
    form,
    setForm: (patch) => { setFormState((f) => ({ ...f, ...patch })); setShown(null); },
    otherMaps,
    otherId: other?.id ?? "",
    setOtherId: (id) => { setOtherId(id); setShown(null); },
    queryWorksheets: datasets.map((d) => ({ id: d.id, name: d.name })),
    queryId: queryDs?.id ?? "",
    setQueryId: (id) => { setQueryId(id); setShown(null); },
    queryColumns,
    queryPicks: qPicks,
    setQueryPick: (slot, index) => { setQueryPicks(qPicks.map((v, i) => (i === slot ? index : v))); setShown(null); },
    seedNote: seedProblem,
    busy: committing.busy,
    error,
    card: shown && shown.mode === mode ? shown.card : null,
    cancel: committing.abort,
    run,
  };
}
