// SIMS workshop, Compare tab — state hook (audit P2.3, box 3). Pick profiles
// and species; the comparison table is previewed LIVE through the same
// `computeSimsCompare` the commit and the pipeline replay run
// (lib/transformSimsCompare.ts), with the optional decade stagger drawn into
// the preview. Create runs ONE recorded `simscompare` transform (one undo
// entry, a replayable step) and then, when a stagger is set, writes each new
// trace's decade offset onto the plot's series styles (a second undo entry —
// the offset is the plot's, not the table's; lib/logOffset.ts).

import { useMemo, useState } from "react";

import { useDebouncedPreview, useLatestRef, tokenOf } from "../../../lib/previewKey";
import { runTransform } from "../../../lib/transformRun";
import { computeSimsCompare, staggerComparison, type SimsCompareComputed, type SimsCompareParams } from "../../../lib/transformSimsCompare";
import { simsSource } from "../../../lib/transformSims";
import type { TransformWarning } from "../../../lib/transformWarnings";
import type { Dataset } from "../../../lib/types";
import { useSimsDialog } from "../../../store/simsDialog";
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";

export const COMPARE_DELAY_MS = 250;
/** The stagger step is a whole number of decades within ±MAX_STAGGER. */
export const MAX_STAGGER = 6;

export interface SpeciesOption {
  name: string;
  /** How many picked profiles have this column. */
  count: number;
}

export interface SimsCompareState {
  datasets: { id: string; name: string }[];
  picked: string[];
  togglePicked: (id: string, on: boolean) => void;
  speciesOptions: SpeciesOption[];
  species: string[];
  toggleSpecies: (name: string, on: boolean) => void;
  stagger: string;
  setStagger: (v: string) => void;
  /** The parsed stagger (0 = none), or null when the text is not allowed. */
  staggerDecades: number | null;
  formError: string | null;
  result: SimsCompareComputed | undefined;
  /** Each preview column's decade offset (the stagger applied in order). */
  offsets: number[];
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

/** The species columns a profile offers (categorical columns are not signals). */
function speciesOf(d: Dataset): string[] {
  const src = simsSource(d);
  const cats = new Set(Object.keys(src.cat_levels ?? {}).map(Number));
  return src.labels.filter((_, i) => !cats.has(i));
}

/** Parse the stagger text: "" or a whole number within ±MAX_STAGGER. */
export function parseStagger(text: string): number | null {
  const t = text.trim();
  if (!t) return 0;
  const n = Number(t);
  return Number.isInteger(n) && Math.abs(n) <= MAX_STAGGER ? n : null;
}

/** The first-seen order of every species across `picked`, with counts. */
export function speciesOptionsOf(picked: readonly Dataset[]): SpeciesOption[] {
  const counts = new Map<string, number>();
  for (const d of picked) for (const s of new Set(speciesOf(d))) counts.set(s, (counts.get(s) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count }));
}

/** Default species: with one profile, all of its species; with several, the
 *  ones every picked profile has (same species across samples). */
export function defaultSpecies(picked: readonly Dataset[]): string[] {
  const opts = speciesOptionsOf(picked);
  return opts.filter((o) => picked.length === 1 || o.count === picked.length).map((o) => o.name);
}

interface Preview {
  key: string;
  result?: SimsCompareComputed;
  error?: string;
}

export function useSimsCompare(): SimsCompareState {
  const seed = useSimsDialog((s) => s.seed);
  const datasets = useApp((s) => s.datasets);
  const selectedIds = useApp((s) => s.selectedIds);
  const [picked, setPicked] = useState<string[]>(() => {
    // Opened on a multi-selection: compare exactly those profiles.
    const sel = selectedIds.filter((id) => datasets.some((d) => d.id === id));
    if (sel.length >= 2) return datasets.filter((d) => sel.includes(d.id)).map((d) => d.id);
    const first = datasets.find((d) => d.id === seed) ?? datasets[0];
    return first ? [first.id] : [];
  });
  const pickedDs = useMemo(
    () => datasets.filter((d) => picked.includes(d.id)),
    [datasets, picked],
  );
  const [species, setSpecies] = useState<string[]>(() => defaultSpecies(pickedDs));
  const [stagger, setStaggerText] = useState("0");
  const [preview, setPreview] = useState<Preview>({ key: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const speciesOptions = useMemo(() => speciesOptionsOf(pickedDs), [pickedDs]);
  const chosen = useMemo(
    () => speciesOptions.map((o) => o.name).filter((n) => species.includes(n)),
    [speciesOptions, species],
  );
  const staggerDecades = parseStagger(stagger);
  const formError = !pickedDs.length
    ? "Pick at least one profile."
    : !chosen.length
      ? "Pick at least one species."
      : staggerDecades === null
        ? `The stagger must be a whole number of decades between −${MAX_STAGGER} and ${MAX_STAGGER}.`
        : null;
  const params = useMemo<SimsCompareParams | null>(
    () =>
      pickedDs.length && chosen.length
        ? { op: "simscompare", species: chosen, with: pickedDs.slice(1).map((d) => ({ id: d.id, name: d.name })) }
        : null,
    [pickedDs, chosen],
  );
  const key = useMemo(
    () => (params ? JSON.stringify([params, pickedDs.map((d) => [d.id, tokenOf(d)])]) : ""),
    [params, pickedDs],
  );
  const inputs = useLatestRef({ params, pickedDs });
  useDebouncedPreview(key, COMPARE_DELAY_MS, () => {
    const { params, pickedDs } = inputs.current;
    if (!params) return undefined;
    const ctrl = new AbortController();
    const profiles = pickedDs.map((d) => ({ id: d.id, name: d.name, data: simsSource(d) }));
    computeSimsCompare(params, profiles, { signal: ctrl.signal }).then(
      (result) => { if (!ctrl.signal.aborted) setPreview({ key, result }); },
      (e: unknown) => { if (!ctrl.signal.aborted) setPreview({ key, error: message(e, "comparison failed") }); },
    );
    return () => { ctrl.abort(); };
  });

  const fresh = preview.key === key && key !== "";
  const result = fresh ? preview.result : undefined;
  const k = staggerDecades ?? 0;
  const offsets = useMemo(() => (result?.data.labels ?? []).map((_, i) => i * k), [result, k]);

  function togglePicked(id: string, on: boolean): void {
    setError(null);
    const next = on ? [...picked, id] : picked.filter((p) => p !== id);
    // Library order: the first picked profile is the transform's primary.
    const ordered = datasets.filter((d) => next.includes(d.id));
    setPicked(ordered.map((d) => d.id));
    // A species list the user never touched follows the default for the new pick.
    if (species.join("\u0000") === defaultSpecies(pickedDs).join("\u0000")) setSpecies(defaultSpecies(ordered));
  }

  async function create(): Promise<void> {
    if (!params || !result || formError || busy) return;
    setBusy(true);
    setError(null);
    try {
      const out = await runTransform(useApp.getState, params, pickedDs[0].id);
      if (!out) return;
      // One undo entry for the whole stagger (a separate one from the
      // dataset's own): the offsets are the PLOT's per-series style.
      const staggered = staggerComparison(useApp.getState, useApp.setState, out.id, k);
      toast(`created ${out.name}${staggered ? `, traces staggered by ${k} decade${Math.abs(k) === 1 ? "" : "s"}` : ""}`, "ok");
    } catch (e) {
      setError(message(e, "comparison failed"));
    } finally {
      setBusy(false);
    }
  }

  return {
    datasets: datasets.map((d) => ({ id: d.id, name: d.name })),
    picked,
    togglePicked,
    speciesOptions,
    species: chosen,
    toggleSpecies: (name, on) => {
      setError(null);
      setSpecies((cur) => (on ? [...cur.filter((n) => n !== name), name] : cur.filter((n) => n !== name)));
    },
    stagger,
    setStagger: (v) => { setError(null); setStaggerText(v); },
    staggerDecades,
    formError,
    result,
    offsets,
    previewError: fresh ? (preview.error ?? null) : null,
    loading: key !== "" && !fresh,
    warnings: result?.warnings ?? [],
    previewOnly: pickedDs.some((d) => d.pending),
    canCreate: Boolean(result) && !formError && !busy,
    busy,
    error,
    create,
  };
}
