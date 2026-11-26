// Math extras workshop — state hook. Eight jobs behind one mode list. The areas
// and the solver answer with a result card; the interpolation, resampling and
// correlation jobs also commit a NEW derived dataset through the shared result
// contract (store/commitComputedOutput: one undo step, no duplicate on a repeat,
// marked out of date when a source changes, inputs and settings recorded; the
// sources are never edited). The work is in mathExtrasRun.

import { useMemo, useState } from "react";

import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { commitComputedOutput } from "../../../store/commitComputedOutput";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { pickColumns, useLoadColumns, validPick, type PickColumn } from "../analysisextras/columnPicks";
import { isAbortError } from "../workbench/useWorkbenchPreview";
import { useWorkbenchCommit } from "../workbench/useWorkbenchCommit";
import { emptyForm, inputOf, type MathForm, type MathInput, type MathMode } from "./mathExtrasForm";
import { runMath, type Card } from "./mathExtrasRun";

export const MATH_EXTRAS_PRODUCER = { id: "math-extras", label: "Math extras", version: 1 } as const;

const isMap = (d: { metadata?: Record<string, unknown> } | undefined): boolean => d?.metadata?.["is2D"] === true;

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
  const [mode, setModeState] = useState<MathMode>("polygon-area");
  const [userPicks, setUserPicks] = useState<number[]>([-1, 0, 1, 2]);
  const [form, setFormState] = useState(emptyForm);
  const [otherId, setOtherId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<{ mode: MathMode; card: Card } | null>(null);

  const columns = useMemo(() => pickColumns(active ?? null), [active]);
  const picks = userPicks.map((p, i) => validPick(columns, p, columns[Math.min(i + 1, columns.length - 1)]?.index ?? -1));
  const otherMaps = datasets.filter((d) => isMap(d.data) && d.id !== active?.id).map((d) => ({ id: d.id, name: d.name }));
  const other = datasets.find((d) => d.id === (otherId || otherMaps[0]?.id)) ?? null;

  const run = async (): Promise<void> => {
    setError(null);
    await committing.run(async (signal) => {
      try {
        const out = await runMath({ mode, form, active: active ?? null, columns, picks, other, load, resolve: resolveDataset, signal });
        signal.throwIfAborted();
        setShown({ mode, card: out.card });
        if (!out.output) return;
        const o = commitComputedOutput({
          producer: MATH_EXTRAS_PRODUCER,
          sources: out.output.sources.map((d) => ({ id: d.id, computedOn: analysisDataFingerprint(d) })),
          settings: { ...out.output.settings, picks },
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
    busy: committing.busy,
    error,
    card: shown && shown.mode === mode ? shown.card : null,
    cancel: committing.abort,
    run,
  };
}
