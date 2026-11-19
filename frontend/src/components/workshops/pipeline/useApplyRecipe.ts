// Apply-recipe state (P2.5 box 4): which datasets, how each one's columns bind
// to the recipe's expected input, each one's live preflight, and the run.
// Every pick is preflighted as it is made and on every edit; Apply runs the
// picks through `applyRecipe`, which preflights again at run time and refuses
// what no longer passes.

import { useCallback, useMemo, useRef, useState } from "react";

import { applyRecipe, type ApplyResult } from "./runTemplate";
import { defaultBindings, preflightRecipe, type Binding, type Preflight } from "../../../lib/recipePreflight";
import type { AnalysisTemplate } from "../../../lib/template";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";

export interface PickState {
  ds: Dataset;
  bindings: Binding[];
  preflight: Preflight;
}

export interface ApplyRecipeState {
  datasets: Dataset[];
  picked: ReadonlySet<string>;
  togglePick: (id: string) => void;
  picks: PickState[];
  bind: (id: string, column: number, b: Binding) => void;
  ackUnits: boolean;
  setAckUnits: (v: boolean) => void;
  ready: number;
  running: boolean;
  /** Per-dataset outcomes — filled in LIVE while a run is in flight. */
  results: ApplyResult[] | null;
  apply: () => Promise<void>;
  /** Stop the run (worksheet audit #15): the dataset in flight is rolled
   *  back, later ones are not run; finished ones stay. */
  cancel: () => void;
  /** Outputs grouped in a folder by the last apply (>= 2 only; `groupName`
   *  set), still in the workspace — what "Overlay these N" plots. */
  groupedIds: string[];
}

export function useApplyRecipe(recipe: AnalysisTemplate, keepActive = false, groupName?: string): ApplyRecipeState {
  const datasets = useApp((s) => s.datasets);
  const selectedIds = useApp((s) => s.selectedIds);
  const activeId = useApp((s) => s.activeId);
  // Seeded once from the Library selection (else the active dataset).
  const [picked, setPicked] = useState<ReadonlySet<string>>(
    () => new Set(selectedIds.length ? selectedIds : activeId ? [activeId] : []),
  );
  const [overrides, setOverrides] = useState<Record<string, Binding[]>>({});
  const [ackUnits, setAckUnits] = useState(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ApplyResult[] | null>(null);
  const [groupedIds, setGroupedIds] = useState<string[]>([]);
  const liveGrouped = useApp((s) => groupedIds.filter((id) => s.datasets.some((d) => d.id === id)).join("|"));
  const controller = useRef<AbortController | null>(null);
  const columns = useMemo(() => recipe.expects?.columns ?? [], [recipe]);

  const picks = useMemo(() => {
    const ids = new Set(datasets.map((d) => d.id));
    // In Library order; a dataset deleted since it was picked drops out.
    return datasets
      .filter((d) => picked.has(d.id))
      .map((ds) => {
        const bindings = overrides[ds.id] ?? defaultBindings(columns, ds.data);
        return { ds, bindings, preflight: preflightRecipe(recipe, ds, bindings, ids, ackUnits) };
      });
  }, [datasets, picked, overrides, columns, recipe, ackUnits]);

  const togglePick = useCallback((id: string) => {
    setResults(null);
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const bind = useCallback(
    (id: string, column: number, b: Binding) => {
      setResults(null);
      setOverrides((o) => {
        const ds = datasets.find((d) => d.id === id);
        if (!ds) return o;
        const cur = [...(o[id] ?? defaultBindings(columns, ds.data))];
        cur[column] = b;
        return { ...o, [id]: cur };
      });
    },
    [columns, datasets],
  );

  const apply = useCallback(async () => {
    const ctl = new AbortController();
    controller.current = ctl;
    setRunning(true);
    setResults([]);
    setGroupedIds([]);
    try {
      const plans = picks.map((p) => ({ datasetId: p.ds.id, bindings: p.bindings }));
      // keepActive: launched from a dialog that works on the ACTIVE worksheet;
      // each output makes itself active, which would re-point the dialog at an
      // output, so applyRecipe hands the view back afterwards.
      const groupFolderName = groupName ? (n: number) => `${groupName} (${n})` : undefined;
      const done = await applyRecipe(recipe, plans, { ackUnits, signal: ctl.signal, onProgress: (r) => setResults([...r]), keepActive, groupFolderName });
      setResults(done);
      const outs = done.filter((r) => r.status === "ok" && r.outputId).map((r) => r.outputId as string);
      if (groupFolderName && outs.length >= 2) setGroupedIds(outs);
    } finally {
      if (controller.current === ctl) controller.current = null;
      setRunning(false);
    }
  }, [recipe, picks, ackUnits, keepActive, groupName]);

  const cancel = useCallback(() => controller.current?.abort(), []);

  const ready = picks.filter((p) => !p.preflight.blocked).length;
  return { datasets, picked, togglePick, picks, bind, ackUnits, setAckUnits, ready, running, results, apply, cancel, groupedIds: liveGrouped ? liveGrouped.split("|") : [] };
}
