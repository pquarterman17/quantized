// SIMS depth-profile workshop — state hook (audit P2.3). One dataset and the
// chosen stages (depth calibration, background, reference normalization,
// smoothing) are previewed LIVE through the same `computeSims` the commit and
// the pipeline replay use (lib/transformSims.ts). Nothing is added to the
// workspace until "Create"; the commit then runs one recorded `sims`
// transform through lib/transformRun (one undo entry and one pipeline step —
// the replayable recipe; per-stage provenance in `metadata.sims_processing`).

import { useMemo, useState } from "react";

import { useDebouncedPreview, useLatestRef, tokenOf } from "../../../lib/previewKey";
import { xUnitOf } from "../../../lib/transformResample";
import { runTransform } from "../../../lib/transformRun";
import { computeSims, simsSource, type SimsComputed } from "../../../lib/transformSims";
import type { TransformWarning } from "../../../lib/transformWarnings";
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
  setRsf: (name: string, text: string) => void;
  formError: string | null;
  result: SimsComputed | undefined;
  previewError: string | null;
  loading: boolean;
  warnings: TransformWarning[];
  /** A still-loading book: the preview is on its downsampled rows. */
  previewOnly: boolean;
  canCreate: boolean;
  busy: boolean;
  error: string | null;
  create: () => Promise<void>;
  close: () => void;
}

const message = (e: unknown, fallback: string): string => (e instanceof Error ? e.message : fallback);

export function useSims(): SimsState {
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
  // in the output's provenance) and its data by object identity.
  const key = useMemo(
    () => (typeof parsed === "string" || !dataset ? "" : JSON.stringify([parsed, dataset.id, tokenOf(dataset)])),
    [parsed, dataset],
  );
  const inputs = useLatestRef({ parsed, dataset, source });
  useDebouncedPreview(key, PREVIEW_DELAY_MS, () => {
    const { parsed, dataset, source } = inputs.current;
    if (typeof parsed === "string" || !dataset || !source) return undefined;
    const ctrl = new AbortController();
    computeSims(parsed, { id: dataset.id, name: dataset.name, data: source }, { signal: ctrl.signal }).then(
      (result) => { if (!ctrl.signal.aborted) setPreview({ key, result }); },
      (e: unknown) => { if (!ctrl.signal.aborted) setPreview({ key, error: message(e, "SIMS processing failed") }); },
    );
    return () => { ctrl.abort(); };
  });

  const fresh = preview.key === key && key !== "";
  const result = fresh ? preview.result : undefined;

  function setForm(patch: Partial<SimsForm>): void {
    setError(null);
    setFormState((f) => ({ ...f, ...patch }));
  }

  function setDatasetId(id: string): void {
    setId(id);
    setError(null);
    const next = datasets.find((d) => d.id === id);
    const nextSource = next ? simsSource(next) : undefined;
    // Keep the stages; re-guess the reference only when the new dataset lacks it.
    setFormState((f) =>
      nextSource?.labels.includes(f.reference) ? f : { ...f, reference: guessReference(nextSource), rsf: {} },
    );
  }

  async function create(): Promise<void> {
    if (typeof parsed === "string" || !dataset || !result) return;
    setBusy(true);
    setError(null);
    try {
      const out = await runTransform(useApp.getState, parsed, dataset.id);
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
    setRsf: (name, text) => {
      setError(null);
      setFormState((f) => ({ ...f, rsf: { ...f.rsf, [name]: text } }));
    },
    formError: typeof parsed === "string" ? parsed : null,
    result,
    previewError: fresh ? (preview.error ?? null) : null,
    loading: key !== "" && !fresh,
    warnings: result?.warnings ?? [],
    previewOnly: Boolean(dataset?.pending),
    canCreate: Boolean(result) && !busy,
    busy,
    error,
    create,
    close,
  };
}
