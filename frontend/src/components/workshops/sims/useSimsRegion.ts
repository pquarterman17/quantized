// SIMS workshop, Region tab — state hook (audit P2.3, box 4). One profile and
// a depth region: every picked species' dose, peak, mean and junction depth
// are measured LIVE by `POST /api/sims/region` (calc.sims_region, the
// formulas and their stated rules), then exported as the backend's
// provenance-stamped CSV or added to the workspace's Reports (the
// `sims_region` report kind). Measuring creates no dataset and records no
// pipeline step: the summary is a report about a profile, not derived data.

import { useMemo, useState } from "react";

import { reportEmit } from "../../../lib/api/report";
import { measureSimsRegion, type SimsRegionResult } from "../../../lib/api/sims";
import { saveBlob } from "../../../lib/download";
import { xExtent } from "../../../lib/plotDecimate";
import { useDebouncedPreview, useLatestRef, tokenOf } from "../../../lib/previewKey";
import { xUnitOf } from "../../../lib/transformResample";
import { simsSource, simsWireDataset, speciesOf } from "../../../lib/transformSims";
import { useSimsDialog } from "../../../store/simsDialog";
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";

export const REGION_DELAY_MS = 250;

export type ThresholdMode = "fraction" | "absolute";

export interface RegionForm {
  lo: string;
  hi: string;
  species: string[];
  mode: ThresholdMode;
  /** Percent of each species' peak (mode "fraction") or an absolute value. */
  threshold: string;
}

export interface SimsRegionState {
  datasets: { id: string; name: string }[];
  datasetId: string;
  setDatasetId: (id: string) => void;
  labels: string[];
  xUnit: string;
  xName: string;
  form: RegionForm;
  setForm: (patch: Partial<RegionForm>) => void;
  formError: string | null;
  result: SimsRegionResult | undefined;
  previewError: string | null;
  loading: boolean;
  busy: boolean;
  exportCsv: () => void;
  addToReports: () => Promise<void>;
}

const message = (e: unknown, fallback: string): string => (e instanceof Error ? e.message : fallback);
const stem = (name: string): string => name.replace(/\.[^.]+$/, "");
const g = (v: number): string => String(Number(v.toPrecision(6)));

/** The dataset's name for the provenance, noting rows the analysis left out. */
export function leftOut(all: number, analysed: number, name: string): string {
  const n = all - analysed;
  return n > 0 ? `${name} (analysis rows: ${n} excluded or filtered row${n === 1 ? "" : "s"} left out)` : name;
}

/** The form's request fields, or one plain message saying what is missing. */
export function regionRequest(
  f: RegionForm,
  labels: readonly string[],
): { lo: number; hi: number; columns: number[]; threshold_mode: ThresholdMode; threshold: number } | string {
  const lo = Number(f.lo);
  const hi = Number(f.hi);
  if (!f.lo.trim() || !f.hi.trim() || !Number.isFinite(lo) || !Number.isFinite(hi)) return "Enter the region's two limits.";
  const columns = labels.flatMap((l, i) => (f.species.includes(l) ? [i] : []));
  if (!columns.length) return "Pick at least one species.";
  const t = Number(f.threshold);
  if (!f.threshold.trim() || !Number.isFinite(t)) return "Enter a threshold.";
  if (f.mode === "fraction" && !(t > 0 && t < 100)) return "The threshold percentage must lie strictly between 0 and 100.";
  return { lo, hi, columns, threshold_mode: f.mode, threshold: f.mode === "fraction" ? t / 100 : t };
}

function defaultForm(labels: readonly string[], time: readonly number[] | undefined): RegionForm {
  const range = time ? xExtent(time) : null;
  return {
    lo: range ? String(range[0]) : "",
    hi: range ? String(range[1]) : "",
    species: [...labels],
    mode: "fraction",
    threshold: "50",
  };
}

interface Preview {
  key: string;
  result?: SimsRegionResult;
  error?: string;
}

export function useSimsRegion(active: boolean): SimsRegionState {
  const seed = useSimsDialog((s) => s.seed);
  const datasets = useApp((s) => s.datasets);
  const addReport = useApp((s) => s.addReport);
  const [datasetId, setId] = useState(() =>
    datasets.some((d) => d.id === seed) ? (seed as string) : (datasets[0]?.id ?? ""),
  );
  const dataset = datasets.find((d) => d.id === datasetId);
  const source = useMemo(() => (dataset ? simsSource(dataset) : undefined), [dataset]);
  const labels = useMemo(() => (source ? speciesOf(source) : []), [source]);
  const [form, setFormState] = useState<RegionForm>(() => defaultForm(labels, source?.time));
  const [preview, setPreview] = useState<Preview>({ key: "" });
  const [busy, setBusy] = useState(false);

  // Indices into the SOURCE's own labels (categorical columns never picked).
  const parsed = useMemo(() => regionRequest(form, source?.labels ?? []), [form, source]);
  // Finding 9: no preview fires while this tab is mounted-but-hidden.
  const key = useMemo(
    () => (!active || typeof parsed === "string" || !dataset ? "" : JSON.stringify([parsed, dataset.id, tokenOf(dataset)])),
    [active, parsed, dataset],
  );
  const inputs = useLatestRef({ parsed, dataset, source });
  useDebouncedPreview(key, REGION_DELAY_MS, () => {
    const { parsed, dataset, source } = inputs.current;
    if (typeof parsed === "string" || !dataset || !source) return undefined;
    const ctrl = new AbortController();
    const body = {
      dataset: simsWireDataset(source),
      // The CSV's provenance line: measured on the ANALYSIS rows, and says so
      // when exclusions or a row filter left some out.
      dataset_name: leftOut(dataset.data.time.length, source.time.length, dataset.name),
      ...parsed,
    };
    measureSimsRegion(body, ctrl.signal).then(
      (result) => { if (!ctrl.signal.aborted) setPreview({ key, result }); },
      (e: unknown) => { if (!ctrl.signal.aborted) setPreview({ key, error: message(e, "region measures failed") }); },
    );
    return () => { ctrl.abort(); };
  });

  const fresh = preview.key === key && key !== "";
  const result = fresh ? preview.result : undefined;
  const xUnit = source ? xUnitOf(source) : "";
  const regionText = result ? `${g(result.region[0])}–${g(result.region[1])}${xUnit ? ` ${xUnit}` : ""}` : "";

  function setDatasetId(id: string): void {
    setId(id);
    const next = datasets.find((d) => d.id === id);
    const src = next ? simsSource(next) : undefined;
    // The region and species belong to the previous profile's depth range
    // and columns: re-seed both, keep the threshold rule.
    setFormState((f) => ({ ...defaultForm(src ? speciesOf(src) : [], src?.time), mode: f.mode, threshold: f.threshold }));
  }

  function exportCsv(): void {
    if (!result || !dataset) return;
    saveBlob(new Blob([result.csv], { type: "text/csv" }), `${stem(dataset.name)}_region_${regionText.replace(/[^\w.-]+/g, "_")}.csv`);
  }

  async function addToReports(): Promise<void> {
    if (!result || !dataset || busy) return;
    setBusy(true);
    try {
      const title = `SIMS region ${regionText} — ${dataset.name}`;
      const { report } = await reportEmit({
        kind: "sims_region",
        result: result as unknown as Record<string, unknown>,
        title,
        source_refs: [{ kind: "dataset", id: dataset.id, name: dataset.name }],
      });
      addReport(title, report, dataset.id);
      toast("added the region measures to Reports", "ok");
    } catch (e) {
      toast(message(e, "could not add the report"), "danger");
    } finally {
      setBusy(false);
    }
  }

  return {
    datasets: datasets.map((d) => ({ id: d.id, name: d.name })),
    datasetId,
    setDatasetId,
    labels,
    xUnit,
    xName: String(source?.metadata?.x_column_name ?? "") || "x",
    form,
    setForm: (patch) => setFormState((f) => ({ ...f, ...patch })),
    formError: typeof parsed === "string" ? parsed : null,
    result,
    previewError: fresh ? (preview.error ?? null) : null,
    loading: key !== "" && !fresh,
    busy,
    exportCsv,
    addToReports,
  };
}
