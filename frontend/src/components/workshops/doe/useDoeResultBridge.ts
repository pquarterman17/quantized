// DOE's result-contract bridge (owner decision 2026-11-25): the design result
// and the effects result as in-tool books (lib/doeAnalysisResult), and the
// reopen of a saved design ("Reopen in tool" refills the setup form with the
// recorded settings and seed, so Generate reproduces the design).

import { useEffect, useMemo } from "react";

import type { DoeEffectsResponse } from "../../../lib/api/doe";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import type { DoeMeta } from "../../../lib/doe";
import { designColumnsOf, doeDesignResultTables, doeEffectsResultTables } from "../../../lib/doeAnalysisResult";
import { snapshotResultKey } from "../../../lib/snapshotResultKey";
import {
  DOE_DESIGN_RESULT, DOE_EFFECTS_RESULT, doeDesignFingerprint, doeEffectsQuestion, type DoeDesignRecipe,
} from "../../../lib/toolResultKinds";
import type { Dataset } from "../../../lib/types";
import { useToolResultRequest } from "../../../store/toolResultRequest";
import { publishDoeDesignResult, publishDoeEffectsResult } from "../../../store/toolResultSave";
import { useApp } from "../../../store/useApp";
import { useLiveTables, useToolResultBook, type ToolResultBook } from "../resultbook/useToolResultBook";
import { INITIAL_SETUP, factorRows, type DoeSetup, type FactorRow } from "./useDoe";

/** The design this session generated, with the setup it was generated from. */
export interface GeneratedDesign { datasetId: string; setup: DoeSetup }

const isRow = (v: unknown): v is FactorRow => typeof v === "object" && v !== null &&
  ["name", "low", "high", "unit", "levels"].every((k) => typeof (v as Record<string, unknown>)[k] === "string");

/** The saved setup on the defaults: only known fields of the same type; null when the factors do not read (fail closed). */
export function restoredSetup(recipe: DoeDesignRecipe): DoeSetup | null {
  const raw = recipe.setup;
  if (!Array.isArray(raw.factors) || !raw.factors.length || !raw.factors.every(isRow)) return null;
  const out: Record<string, unknown> = { ...INITIAL_SETUP };
  for (const [key, value] of Object.entries(raw)) {
    const base = (INITIAL_SETUP as unknown as Record<string, unknown>)[key];
    if (key !== "factors" && key in INITIAL_SETUP && (typeof base === typeof value || (key === "p" && (value === null || typeof value === "number")))) out[key] = value;
  }
  const factors = (raw.factors as FactorRow[]).map((f) => ({ ...f }));
  return { ...(out as unknown as DoeSetup), k: factors.length, factors: factorRows(factors.length, factors) };
}

export function useDoeReopen(setSetup: (setup: DoeSetup) => void): void {
  const request = useToolResultRequest((s) => s.doe);
  const consume = useToolResultRequest((s) => s.consume);
  const setStatus = useApp((s) => s.setStatus);
  useEffect(() => {
    if (!request) return;
    const setup = restoredSetup(request);
    if (setup) setSetup(setup);
    else setStatus("the saved design's settings could not be read; the form was left as it was", "danger");
    consume("doe");
  }, [consume, request, setSetup, setStatus]);
}

export interface ToolSave { book: ToolResultBook; canSave: boolean; saveBlocked: string | null; save: () => string | null }

export function useDoeDesignBook(active: Dataset, meta: DoeMeta, generated: GeneratedDesign | null): ToolSave {
  const columns = useMemo(() => designColumnsOf(active.data, meta), [active.data, meta]);
  const fingerprint = active.pending ? null : doeDesignFingerprint(columns, active);
  // Any current saved design of this worksheet (its recipe need not be known here).
  const savedId = useApp((s) => fingerprint === null ? null : s.analysisResults.find((r) => r.producer.id === DOE_DESIGN_RESULT && !r.stale &&
    r.sources[0]?.datasetId === active.id && r.sourceFingerprint === fingerprint)?.id ?? null);
  const input = useMemo(() => ({ data: active.data, meta }), [active.data, meta]);
  const liveTables = useLiveTables(input, (i) => doeDesignResultTables(i.data, i.meta));
  const book = useToolResultBook({ savedId, liveTables });
  const mine = generated?.datasetId === active.id ? generated : null;
  const saveBlocked = book.saved ? "This design is already saved."
    : active.pending ? "Load the full worksheet before saving this design."
      : !mine ? "A design is saved right after it is generated here: this worksheet's generation settings are not recorded." : null;
  const save = () => (mine && !saveBlocked ? publishDoeDesignResult(active, { setup: { ...mine.setup }, designColumns: columns }, meta) : null);
  return { book, canSave: saveBlocked === null, saveBlocked, save };
}

export function useDoeEffectsBook(active: Dataset, meta: DoeMeta, out: DoeEffectsResponse | null): ToolSave {
  const recipe = useMemo(() => ({ responseLabel: meta.response_label, terms: meta.terms_coded }), [meta]);
  const fingerprint = active.pending ? null : analysisDataFingerprint(active);
  const savedKey = out && fingerprint ? snapshotResultKey(DOE_EFFECTS_RESULT, active.id, fingerprint, doeEffectsQuestion(recipe)) : null;
  const liveTables = useLiveTables(out, doeEffectsResultTables);
  const book = useToolResultBook({ savedKey, liveTables });
  const saveBlocked = book.saved ? "These effects are already saved." : active.pending ? "Load the full worksheet before saving."
    : !out ? "Wait for the effects to be computed." : null;
  const save = () => (out && !saveBlocked ? publishDoeEffectsResult(active, recipe, meta, out) : null);
  return { book, canSave: saveBlocked === null, saveBlocked, save };
}
