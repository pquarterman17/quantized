// Apply-recipe state (P2.5 box 4): which datasets, how each one's columns bind
// to the recipe's expected input, each one's live preflight, and the run.
// Every pick is preflighted as it is made and on every edit; Apply runs the
// picks through `applyRecipe`, which preflights again at run time and refuses
// what no longer passes.

import { useCallback, useMemo, useState } from "react";

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
  results: ApplyResult[] | null;
  apply: () => Promise<void>;
}

export function useApplyRecipe(recipe: AnalysisTemplate): ApplyRecipeState {
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
    setRunning(true);
    try {
      setResults(await applyRecipe(recipe, picks.map((p) => ({ datasetId: p.ds.id, bindings: p.bindings })), { ackUnits }));
    } finally {
      setRunning(false);
    }
  }, [recipe, picks, ackUnits]);

  const ready = picks.filter((p) => !p.preflight.blocked).length;
  return { datasets, picked, togglePick, picks, bind, ackUnits, setAckUnits, ready, running, results, apply };
}
