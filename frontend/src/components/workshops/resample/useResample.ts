// Resample / align workshop — state hook (audit P2.5, "previewed
// align/interpolate"). The pick (one or more datasets) and the target grid are
// previewed LIVE through the same `computeResample` the commit and the
// pipeline replay use (lib/transformResample.ts): every picked dataset is
// resampled by the backend (debounced), and the result, the row counts and
// the warnings are shown before anything is created. Nothing is added to the
// workspace until "Create"; the commit then runs one recorded `resample`
// transform per dataset through lib/transformRun (one undo entry and one
// pipeline step each; provenance and warnings stamped into the metadata).
//
// Aligning several datasets to a common grid = pick them all with one grid
// (fixed points/step/range, or "match" one dataset's x — that dataset is the
// grid and is not itself resampled). An x unit mismatch keeps Create disabled
// until the explicit acknowledgment for THIS pick and grid is ticked.

import { useEffect, useMemo, useRef, useState } from "react";

import {
  computeResample,
  resampleSource,
  xUnitConflict,
  type ResampleComputed,
  type ResampleParams,
} from "../../../lib/transformResample";
import { runTransform } from "../../../lib/transformRun";
import { needsConfirm, type TransformWarning } from "../../../lib/transformWarnings";
import type { Dataset } from "../../../lib/types";
import { useResampleDialog } from "../../../store/resampleDialog";
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import { defaultForm, formToParams, withRangeDefaults, type ResampleForm } from "./resampleForm";

/** Debounce between an edit and the preview request. */
export const PREVIEW_DELAY_MS = 250;

export interface PreviewEntry {
  id: string;
  name: string;
  result?: ResampleComputed;
  error?: string;
}

interface Previews {
  key: string;
  entries: PreviewEntry[];
}

export interface ResampleState {
  datasets: { id: string; name: string }[];
  picks: string[];
  togglePick: (id: string, on: boolean) => void;
  form: ResampleForm;
  setForm: (patch: Partial<ResampleForm>) => void;
  /** The form's problem, if it cannot be previewed yet. */
  formError: string | null;
  /** Picks actually resampled (the "match" dataset is the grid, not a pick). */
  targets: Dataset[];
  /** Fresh preview entries for `targets` (empty while a preview is pending). */
  entries: PreviewEntry[];
  loading: boolean;
  focusId: string;
  setFocusId: (id: string) => void;
  channel: number;
  setChannel: (c: number) => void;
  warnings: TransformWarning[];
  blockedByUnits: boolean;
  unitsAcknowledged: boolean;
  setUnitsAcknowledged: (ok: boolean) => void;
  canCreate: boolean;
  busy: boolean;
  error: string | null;
  create: () => Promise<void>;
  close: () => void;
}

const message = (e: unknown, fallback: string): string => (e instanceof Error ? e.message : fallback);

// A dataset's identity token: the store replaces a Dataset object on every
// edit (data, exclusions, filters), so a new object = possibly new rows.
const tokens = new WeakMap<Dataset, number>();
let nextToken = 0;
function tokenOf(ds: Dataset): number {
  let t = tokens.get(ds);
  if (t === undefined) {
    t = ++nextToken;
    tokens.set(ds, t);
  }
  return t;
}

export function useResample(): ResampleState {
  const seed = useResampleDialog((s) => s.seed);
  const close = useResampleDialog((s) => s.close);
  const datasets = useApp((s) => s.datasets);
  const [picks, setPicks] = useState<string[]>(() => (seed ?? []).filter((id) => datasets.some((d) => d.id === id)));
  const [form, setFormState] = useState<ResampleForm>(() =>
    defaultForm(datasets.find((d) => !(seed ?? []).includes(d.id))?.id ?? datasets[0]?.id ?? ""),
  );
  const [focus, setFocusId] = useState("");
  const [channel, setChannel] = useState(0);
  const [previews, setPreviews] = useState<Previews>({ key: "", entries: [] });
  const [ackFor, setAckFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => formToParams(form, datasets), [form, datasets]);
  const matchDs = form.mode === "match" ? datasets.find((d) => d.id === form.matchId) : undefined;
  const targets = useMemo(
    () => picks.flatMap((id) => datasets.find((d) => d.id === id && d.id !== matchDs?.id) ?? []),
    [picks, datasets, matchDs],
  );
  // Everything the preview depends on: the grid, the pick, and the data of
  // every picked dataset and of the match dataset (by object identity —
  // `tokenOf`).
  const key = useMemo(
    () =>
      typeof parsed === "string"
        ? ""
        : JSON.stringify([parsed, targets.map((d) => [d.id, tokenOf(d)]), matchDs ? tokenOf(matchDs) : null]),
    [parsed, targets, matchDs],
  );

  // The preview re-runs when the KEY changes, not whenever an unrelated store
  // change hands `targets` / `matchDs` a new identity (adding or renaming
  // another dataset, or each addDataset during create()). The inputs are read
  // from a ref the effect above keeps current (effects run in order).
  const inputs = useRef({ parsed, targets, matchDs });
  useEffect(() => {
    inputs.current = { parsed, targets, matchDs };
  });
  useEffect(() => {
    const { parsed, targets, matchDs } = inputs.current;
    if (typeof parsed === "string" || !targets.length) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      const match = matchDs ? { name: matchDs.name, data: matchDs.data } : null;
      void Promise.all(
        targets.map(async (ds): Promise<PreviewEntry> => {
          try {
            const result = await computeResample(parsed, { name: ds.name, data: resampleSource(ds) }, match, {
              preview: true,
              signal: ctrl.signal,
            });
            return { id: ds.id, name: ds.name, result };
          } catch (e) {
            return { id: ds.id, name: ds.name, error: message(e, "resample failed") };
          }
        }),
      ).then((entries) => {
        if (!ctrl.signal.aborted) setPreviews({ key, entries });
      });
    }, PREVIEW_DELAY_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [key]);

  const fresh = previews.key === key && key !== "";
  const entries = fresh ? previews.entries : [];
  const warnings = entries.flatMap((e) => e.result?.warnings ?? []);
  const unitsAcknowledged = ackFor === key && key !== "";
  const blockedByUnits = needsConfirm(warnings) && !unitsAcknowledged;
  const allOk = entries.length === targets.length && entries.every((e) => e.result);
  const focusId = targets.some((d) => d.id === focus) ? focus : (targets[0]?.id ?? "");

  function setForm(patch: Partial<ResampleForm>): void {
    setError(null);
    setFormState((f) => {
      const next = { ...f, ...patch };
      if (patch.mode === "step" || patch.mode === "range") {
        return withRangeDefaults(next, datasets.find((d) => d.id === picks[0])?.data);
      }
      return next;
    });
  }

  async function create(): Promise<void> {
    if (typeof parsed === "string" || !allOk) return;
    // The acknowledgment is recorded per dataset as the exact unit pair it
    // accepted, so a replay onto differently-mismatched units is refused.
    const paramsFor = (ds: Dataset): ResampleParams => {
      const pair = unitsAcknowledged && matchDs ? xUnitConflict(resampleSource(ds), matchDs.data) : undefined;
      return pair ? { ...parsed, acceptedXUnits: pair } : parsed;
    };
    const s = useApp.getState;
    // The active dataset first, so its step is the one a template batch
    // applies to each file (inputIsTarget); the rest are explicit references.
    const active = s().activeId;
    const order = [...targets].sort((a, b) => Number(b.id === active) - Number(a.id === active));
    setBusy(true);
    setError(null);
    const made: Dataset[] = [];
    const failed: string[] = [];
    for (const ds of order) {
      try {
        if (await runTransform(s, paramsFor(ds), ds.id)) made.push(ds);
      } catch (e) {
        failed.push(`${ds.name}: ${message(e, "resample failed")}`);
      }
    }
    setBusy(false);
    if (made.length) toast(`created ${made.length} resampled dataset${made.length === 1 ? "" : "s"}`, "ok");
    if (!failed.length) {
      close();
      return;
    }
    // Untick what WAS created, so fixing the rest and pressing Create again
    // does not create those a second time.
    setPicks((p) => p.filter((id) => !made.some((d) => d.id === id)));
    const done = made.length ? `resampled ${made.map((d) => d.name).join(", ")} (now unticked); ` : "";
    setError(`${done}not created — ${failed.join("; ")}`);
  }

  return {
    datasets: datasets.map((d) => ({ id: d.id, name: d.name })),
    picks,
    togglePick: (id, on) => setPicks((p) => (on ? (p.includes(id) ? p : [...p, id]) : p.filter((x) => x !== id))),
    form,
    setForm,
    formError: typeof parsed === "string" ? parsed : null,
    targets,
    entries,
    loading: key !== "" && targets.length > 0 && !fresh,
    focusId,
    setFocusId,
    channel,
    setChannel,
    warnings,
    blockedByUnits,
    unitsAcknowledged,
    setUnitsAcknowledged: (ok) => setAckFor(ok ? key : null),
    canCreate: allOk && !blockedByUnits && !busy && targets.length > 0,
    busy,
    error,
    create,
    close,
  };
}
