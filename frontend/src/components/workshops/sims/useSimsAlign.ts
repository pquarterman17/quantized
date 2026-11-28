// SIMS workshop, Align tab — state hook (roadmap row 23, multi-profile
// alignment). Pick two or more profiles, the reference species and whether to
// align on its peak or junction depth; the aligned comparison is previewed LIVE
// through the same `computeSimsAlign` the commit and the pipeline replay run
// (lib/transformSimsAlign.ts). Create is ONE recorded `simsalign` transform
// (one undo entry, one replayable step, one combined worksheet — provisional,
// owner to confirm). Close (unmount) aborts a pending Create: nothing is added.

import { useEffect, useMemo, useRef, useState } from "react";

import { tokenOf } from "../../../lib/previewKey";
import { simsSource, speciesOf } from "../../../lib/transformSims";
import { computeSimsAlign, type SimsAlignBy, type SimsAlignComputed, type SimsAlignParams } from "../../../lib/transformSimsAlign";
import type { TransformWarning } from "../../../lib/transformWarnings";
import { commitTransformOutput } from "../../../store/commitTransformOutput";
import { useSimsDialog } from "../../../store/simsDialog";
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import { isAbortError, useWorkbenchPreview } from "../workbench/useWorkbenchPreview";

export const ALIGN_DELAY_MS = 250;

export interface SimsAlignState {
  datasets: { id: string; name: string }[];
  picked: string[];
  togglePicked: (id: string, on: boolean) => void;
  /** Species every picked profile has (the only ones that can be aligned on). */
  commonSpecies: string[];
  reference: string;
  setReference: (name: string) => void;
  by: SimsAlignBy;
  setBy: (by: SimsAlignBy) => void;
  /** Percent of the reference's peak (junction only). */
  thresholdPct: string;
  setThresholdPct: (v: string) => void;
  extra: string[];
  toggleExtra: (name: string, on: boolean) => void;
  /** Replace the extra species at once (a preset). */
  setExtra: (names: string[]) => void;
  formError: string | null;
  result: SimsAlignComputed | undefined;
  previewError: string | null;
  loading: boolean;
  warnings: TransformWarning[];
  previewOnly: boolean;
  canCreate: boolean;
  busy: boolean;
  error: string | null;
  create: () => Promise<void>;
}

const message = (e: unknown, fallback: string): string => (e instanceof Error ? e.message : fallback);

export function useSimsAlign(active: boolean): SimsAlignState {
  const seed = useSimsDialog((s) => s.seed);
  const datasets = useApp((s) => s.datasets);
  const selectedIds = useApp((s) => s.selectedIds);
  const [picked, setPicked] = useState<string[]>(() => {
    const sel = selectedIds.filter((id) => datasets.some((d) => d.id === id));
    if (sel.length >= 2) return datasets.filter((d) => sel.includes(d.id)).map((d) => d.id);
    const first = datasets.find((d) => d.id === seed) ?? datasets[0];
    return first ? [first.id] : [];
  });
  const pickedDs = useMemo(() => datasets.filter((d) => picked.includes(d.id)), [datasets, picked]);
  const commonSpecies = useMemo(() => {
    const lists = pickedDs.map((d) => speciesOf(simsSource(d)));
    return (lists[0] ?? []).filter((s) => lists.every((l) => l.includes(s)));
  }, [pickedDs]);
  const [refPick, setReference] = useState("");
  const [by, setByState] = useState<SimsAlignBy>("peak");
  const [thresholdPct, setThresholdText] = useState("50");
  const [extraPick, setExtra] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The reference follows the picked profiles: a stale pick falls back to the first common species.
  const reference = commonSpecies.includes(refPick) ? refPick : (commonSpecies[0] ?? "");
  const extra = extraPick.filter((s) => commonSpecies.includes(s) && s !== reference);
  const pct = Number(thresholdPct);
  const formError = pickedDs.length < 2
    ? "Pick at least 2 profiles to align."
    : !reference
      ? "The picked profiles share no species to align on."
      : by === "junction" && !(thresholdPct.trim() && pct > 0 && pct < 100)
        ? "The junction threshold must lie strictly between 0 and 100 percent of the peak."
        : null;

  const params = useMemo<SimsAlignParams | null>(
    () => formError ? null : {
      op: "simsalign", reference, by, species: [reference, ...extra],
      with: pickedDs.slice(1).map((d) => ({ id: d.id, name: d.name })),
      ...(by === "junction" ? { threshold: { mode: "fraction" as const, value: pct / 100 } } : {}),
    },
    [formError, reference, by, extra, pickedDs, pct],
  );
  const key = useMemo(
    () => (active && params ? JSON.stringify([params, pickedDs.map((d) => [d.id, tokenOf(d)])]) : ""),
    [active, params, pickedDs],
  );
  const preview = useWorkbenchPreview<SimsAlignComputed>({
    key,
    delayMs: ALIGN_DELAY_MS,
    fallbackError: "alignment failed",
    run: (signal) => {
      if (!params) return Promise.reject(new Error("nothing to align"));
      const profiles = pickedDs.map((d) => ({ id: d.id, name: d.name, data: simsSource(d) }));
      return computeSimsAlign(params, profiles, { signal });
    },
  });
  const result = preview.current ?? undefined;

  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  async function create(): Promise<void> {
    if (!params || !result || busy) return;
    setBusy(true);
    setError(null);
    const ctrl = new AbortController();
    pending.current = ctrl;
    try {
      const out = await commitTransformOutput(useApp.getState, params, pickedDs[0].id, undefined, ctrl.signal);
      if (!out) return;
      void import("./simsAlignPresetAdapter").then((m) => m.recordSimsAlignRun({ by, reference, thresholdPct, extra })).catch(() => undefined);
      toast(out.existing ? `${out.name} is already added; nothing was duplicated` : `created ${out.name}`, "ok");
    } catch (e) {
      if (!ctrl.signal.aborted && !isAbortError(e)) setError(message(e, "alignment failed"));
    } finally {
      if (pending.current === ctrl) pending.current = null;
      setBusy(false);
    }
  }

  return {
    datasets: datasets.map((d) => ({ id: d.id, name: d.name })),
    picked,
    togglePicked: (id, on) => {
      setError(null);
      const next = on ? [...picked, id] : picked.filter((p) => p !== id);
      // Library order: the first picked profile is the depth reference.
      setPicked(datasets.filter((d) => next.includes(d.id)).map((d) => d.id));
    },
    commonSpecies,
    reference,
    setReference: (n) => { setError(null); setReference(n); },
    by,
    setBy: (v) => { setError(null); setByState(v); },
    thresholdPct,
    setThresholdPct: (v) => { setError(null); setThresholdText(v); },
    extra,
    setExtra: (names) => { setError(null); setExtra(names); },
    toggleExtra: (name, on) => {
      setError(null);
      setExtra((cur) => (on ? [...cur.filter((n) => n !== name), name] : cur.filter((n) => n !== name)));
    },
    formError,
    result,
    previewError: preview.error || null,
    loading: preview.loading,
    warnings: result?.warnings ?? [],
    previewOnly: pickedDs.some((d) => d.pending),
    canCreate: Boolean(result) && !formError && !busy,
    busy,
    error,
    create,
  };
}
