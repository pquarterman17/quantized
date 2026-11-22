// "Batch over selected worksheets" for the reductions that read one scan:
// FFT film thickness, Reflectivity FFT and Pawley (lane BY3). Thin wrappers
// over StatsBatchSection; what a worksheet means is in reductionBatchItems.ts.
// Williamson-Hall has its own batch and the XRD reference sticks have none
// (they are drawn once on the shared plot; see the roadmap, D2).

import { useCallback, useMemo } from "react";

import type { Dataset } from "../../../lib/types";
import StatsBatchSection from "../analysisselection/StatsBatchSection";
import {
  FFT_THICKNESS_BATCH_HEADERS, PAWLEY_BATCH_HEADERS, REFLECTIVITY_FFT_BATCH_HEADERS,
  fftThicknessBatchItem, pawleyBatchItem, reflectivityFftBatchItem,
} from "./reductionBatchItems";
import {
  type PawleyCentering, type PawleyFields, type PawleyTie, pawleyInputProblem, pawleyNumbers,
} from "./pawleyInputs";
import { type FftThicknessSettings, type ReflectivityFftSettings, unitOf } from "./reductionRequests";

/** The panel's channel NAME (the batch reads the same-named column), or why not. */
function channelName(active: Dataset | null, col: number): { name: string | null; problem: string | null } {
  const name = active?.data.labels[col] ?? "";
  return name ? { name, problem: null } : { name: null, problem: "The chosen channel has no name, so other worksheets cannot be matched to it." };
}

export function FftThicknessBatch({ active, col, settings }: { active: Dataset | null; col: number; settings: FftThicknessSettings }) {
  const { name, problem } = channelName(active, col);
  const blocked = problem ?? (settings.wavelength > 0 ? null : "Set a positive wavelength first.");
  const runItem = useCallback(async (dataset: Dataset) => {
    if (!name) throw new Error(problem ?? "Pick a channel first.");
    return fftThicknessBatchItem(dataset, name, settings);
  }, [name, problem, settings]);
  return <StatsBatchSection
    toolId="fft-thickness" label="FFT thickness"
    meaning={`Each worksheet is run on its column named "${name ?? "—"}", with 2θ from its X axis and this panel's wavelength, range, window and maximum thickness. A worksheet that records a different wavelength, or whose x is not 2θ in degrees, fails.`}
    summaryColumns={FFT_THICKNESS_BATCH_HEADERS} runItem={runItem}
    resultParameters={{ ...(name ? { channel: name } : {}), ...settings }} blockedReason={blocked}
  />;
}

export function ReflectivityFftBatch({ active, col, settings }: { active: Dataset | null; col: number; settings: ReflectivityFftSettings }) {
  const { name, problem } = channelName(active, col);
  const rangeUnit = unitOf(active?.data);
  const blocked = problem ?? (!settings.isNeutron && !(settings.wavelength > 0) ? "Set a positive wavelength for XRR (2θ) mode." : null);
  const runItem = useCallback(async (dataset: Dataset) => {
    if (!name) throw new Error(problem ?? "Pick a channel first.");
    return reflectivityFftBatchItem(dataset, name, settings, rangeUnit);
  }, [name, problem, settings, rangeUnit]);
  return <StatsBatchSection
    toolId="reflectivity-fft" label="Reflectivity FFT"
    meaning={`Each worksheet is run on its column named "${name ?? "—"}" in this panel's mode (${settings.isNeutron ? "Q, neutron" : "2θ, X-ray"}) and settings. A worksheet whose own axis reads as the other mode, or (X-ray) records a different wavelength, fails.`}
    summaryColumns={REFLECTIVITY_FFT_BATCH_HEADERS} runItem={runItem}
    resultParameters={{ ...(name ? { channel: name } : {}), ...settings, rangeUnit }} blockedReason={blocked}
  />;
}

interface PawleyBatchProps {
  active: Dataset | null; col: number; fields: PawleyFields; tie: PawleyTie; symmetry: PawleyCentering; refineCell: boolean;
}

export function PawleyBatch({ active, col, fields, tie, symmetry, refineCell }: PawleyBatchProps) {
  const { name, problem } = channelName(active, col);
  const n = useMemo(() => pawleyNumbers(fields, tie), [fields, tie]);
  const blocked = problem ?? pawleyInputProblem(n);
  const runItem = useCallback(async (dataset: Dataset) => {
    if (!name) throw new Error(problem ?? "Pick a channel first.");
    return pawleyBatchItem(dataset, name, { n, symmetry, tie, refineCell });
  }, [name, problem, n, symmetry, tie, refineCell]);
  return <StatsBatchSection
    toolId="pawley" label="Pawley"
    meaning={`Each worksheet is refined from this panel's starting cell, axes, centering, wavelength and profile width, on its column named "${name ?? "—"}". A worksheet whose x is not 2θ in degrees, or that records a different wavelength, fails. The result is the refined cell and fit quality; the model is not added to the Library.`}
    summaryColumns={PAWLEY_BATCH_HEADERS} runItem={runItem}
    resultParameters={{ ...(name ? { channel: name } : {}), ...fields, tie, symmetry, refineCell }} blockedReason={blocked}
  />;
}
