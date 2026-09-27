// SIMS depth-profile workshop — state hook (audit P2.3). One dataset and the
// chosen stages (depth calibration, background, reference normalization,
// smoothing) are previewed LIVE through the same `computeSims` the commit and
// the pipeline replay use (lib/transformSims.ts). Nothing is added to the
// workspace until "Create"; the commit then runs one recorded `sims`
// transform through lib/transformRun (one undo entry and one pipeline step —
// the replayable recipe; per-stage provenance in `metadata.sims_processing`).

import { useMemo, useState } from "react";

import { useAckForKey, useDebouncedPreview, useLatestRef, tokenOf } from "../../../lib/previewKey";
import { xUnitOf } from "../../../lib/transformResample";
import { runTransform } from "../../../lib/transformRun";
import { computeSims, simsSource, type SimsComputed, type SimsParams } from "../../../lib/transformSims";
import { needsConfirm, type TransformWarning } from "../../../lib/transformWarnings";
import type { DataStruct } from "../../../lib/types";
import { useSimsDialog } from "../../../store/simsDialog";
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import { defaultForm, formToParams, guessReference, type SimsForm } from "./simsForm";

/** Debounce between an edit and the preview request. */
export const PREVIEW_DELAY_MS = 250;

interface Preview {
  key: string;
  result?: SimsComputed;
  error?: string;
}

export interface SimsState {
  datasets: { id: string; name: string }[];
  datasetId: string;
  setDatasetId: (id: string) => void;
  /** The analysis rows being processed (undefined with no dataset). */
  source: DataStruct | undefined;
  labels: string[];
  /** x's recorded unit ("" when unknown). */
  xUnit: string;
  xName: string;
  form: SimsForm;
  setForm: (patch: Partial<SimsForm>) => void;
  /** Change the normalization reference, swapping the background's guessed
   *  `keep` default for it too — but only while `bgKeep` is still exactly
   *  that untouched default (finding 7); a user edit is never overwritten. */
  setReference: (name: string) => void;
  setRsf: (name: string, text: string) => void;
  formError: string | null;
  result: SimsComputed | undefined;
  previewError: string | null;
  loading: boolean;
  warnings: TransformWarning[];
  /** A still-loading book: the preview is on its downsampled rows. */
  previewOnly: boolean;
  /** A confirm-level warning (calibration's `unit-override`) is present and
   *  not yet acknowledged for this exact preview — Create stays disabled. */
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

export function useSims(active: boolean): SimsState {
  const seed = useSimsDialog((s) => s.seed);
  const close = useSimsDialog((s) => s.close);
  const datasets = useApp((s) => s.datasets);
  const [datasetId, setId] = useState(() =>
    datasets.some((d) => d.id === seed) ? (seed as string) : (datasets[0]?.id ?? ""),
  );
  const dataset = datasets.find((d) => d.id === datasetId);
  const source = useMemo(() => (dataset ? simsSource(dataset) : undefined), [dataset]);
  const [form, setFormState] = useState<SimsForm>(() => defaultForm(source));
  const [preview, setPreview] = useState<Preview>({ key: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const labels = useMemo(() => [...(source?.labels ?? [])], [source]);
  const parsed = useMemo(() => formToParams(form, labels), [form, labels]);
  // Everything the preview depends on: the params, the dataset id (recorded
  // in the output's provenance) and its data by object identity. Finding 9:
  // a tab stays MOUNTED (hidden) when the workshop switches away from it, so
  // its form keeps its half-filled state -- but that means its debounced
  // preview would otherwise keep firing full-dataset POSTs in the
  // background too. `active` (this tab being the VISIBLE one) gates the key
  // to `""`, which `useDebouncedPreview` already treats as "nothing to
  // preview" -- the same no-op path an incomplete form takes.
  const key = useMemo(
    () => (!active || typeof parsed === "string" || !dataset ? "" : JSON.stringify([parsed, dataset.id, tokenOf(dataset)])),
    [active, parsed, dataset],
  );
  const inputs = useLatestRef({ parsed, dataset, source });
  useDebouncedPreview(key, PREVIEW_DELAY_MS, () => {
    const { parsed, dataset, source } = inputs.current;
    if (typeof parsed === "string" || !dataset || !source) return undefined;
    const ctrl = new AbortController();
    computeSims(parsed, { id: dataset.id, name: dataset.name, data: source }, { preview: true, signal: ctrl.signal }).then(
      (result) => { if (!ctrl.signal.aborted) setPreview({ key, result }); },
      (e: unknown) => { if (!ctrl.signal.aborted) setPreview({ key, error: message(e, "SIMS processing failed") }); },
    );
    return () => { ctrl.abort(); };
  });

  const fresh = preview.key === key && key !== "";
  const result = fresh ? preview.result : undefined;
  const warnings = result?.warnings ?? [];
  // Finding 1: a confirm-level warning (calibration's `unit-override`) must
  // never pass on a plain OK — mirrors useResample.ts's `unitsAcknowledged`,
  // re-armed whenever `key` changes (a different form or dataset).
  const { acknowledged: unitsAcknowledged, setAcknowledged: setUnitsAcknowledged } = useAckForKey(key);
  const blockedByUnits = needsConfirm(warnings) && !unitsAcknowledged;

  function setForm(patch: Partial<SimsForm>): void {
    setError(null);
    setFormState((f) => ({ ...f, ...patch }));
  }

  /** Finding 7: change the reference and, only while `bgKeep` is still
   *  exactly the untouched guessed default (`[oldReference]`), swap that
   *  default for the new one — a user who added or removed entries keeps
   *  their own choice. */
  function setReference(name: string): void {
    setError(null);
    setFormState((f) => {
      const wasGuessDefault = f.bgKeep.length === 1 && f.bgKeep[0] === f.reference;
      return { ...f, reference: name, bgKeep: wasGuessDefault ? (name ? [name] : []) : f.bgKeep };
    });
  }

  function setDatasetId(id: string): void {
    setId(id);
    setError(null);
    const next = datasets.find((d) => d.id === id);
    const nextSource = next ? simsSource(next) : undefined;
    // Keep the stages (on/off); re-guess the reference (and its background
    // `keep` default) only when the new dataset lacks the current one — but
    // the calibration time-unit override and the background region are
    // specific to the PREVIOUS dataset's x unit/range and must never leak
    // onto a different profile regardless of whether the reference still
    // resolves (finding 7): reset them on every dataset switch.
    setFormState((f) => {
      if (nextSource?.labels.includes(f.reference)) return { ...f, bgLo: "", bgHi: "", timeUnit: "" };
      const reference = guessReference(nextSource);
      return { ...f, reference, rsf: {}, bgKeep: reference ? [reference] : [], bgLo: "", bgHi: "", timeUnit: "" };
    });
  }

  async function create(): Promise<void> {
    if (typeof parsed === "string" || !dataset || !source || !result || blockedByUnits) return;
    setBusy(true);
    setError(null);
    try {
      // A stated calibration time-unit override is recorded as the exact
      // (recorded, stated) pair just accepted (finding 2) — never a blanket
      // flag a future replay would apply unconditionally.
      const toRun: SimsParams =
        parsed.calibration?.timeUnit
          ? { ...parsed, calibration: { ...parsed.calibration, acceptedTimeUnit: [xUnitOf(source), parsed.calibration.timeUnit] } }
          : parsed;
      const out = await runTransform(useApp.getState, toRun, dataset.id);
      if (out) {
        toast(`created ${out.name}`, "ok");
        close();
      }
    } catch (e) {
      setError(message(e, "SIMS processing failed"));
    } finally {
      setBusy(false);
    }
  }

  return {
    datasets: datasets.map((d) => ({ id: d.id, name: d.name })),
    datasetId,
    setDatasetId,
    source,
    labels,
    xUnit: source ? xUnitOf(source) : "",
    xName: String(source?.metadata?.x_column_name ?? "") || "x",
    form,
    setForm,
    setReference,
    setRsf: (name, text) => {
      setError(null);
      setFormState((f) => ({ ...f, rsf: { ...f.rsf, [name]: text } }));
    },
    formError: typeof parsed === "string" ? parsed : null,
    result,
    previewError: fresh ? (preview.error ?? null) : null,
    loading: key !== "" && !fresh,
    warnings,
    previewOnly: Boolean(dataset?.pending),
    blockedByUnits,
    unitsAcknowledged,
    setUnitsAcknowledged,
    canCreate: Boolean(result) && !busy && !blockedByUnits,
    busy,
    error,
    create,
    close,
  };
}
