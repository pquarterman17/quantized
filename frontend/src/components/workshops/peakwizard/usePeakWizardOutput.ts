// Step ⑤ of the Peak Wizard: the integrate-only path (#32) and landing the
// result as a #36 report. Extracted from usePeakWizard.ts verbatim apart from
// the engine switch (audit P2.4 slice 2) — that file sat at 490 lines against
// the 500-line ceiling and wiring the model engine in had to be funded by a
// split, the same move usePeakBaseline.ts made for P3.5.
//
// Which fit feeds step ⑤ is the ACTIVE engine's: the mixed-shape model result
// (reported through the `peak_model_fit` emitter, which carries each peak's
// shape and every standard error) or the classic multifit (`multipeak_fit`).
// The report is the wizard's durable output, as before; it never writes the
// Peaks workshop's durable peak table (it never did).

import { useCallback, useState } from "react";

import type { PeakModelFitResponse } from "../../../lib/api/peaks";
import { peaksIntegrate, reportEmit, type IntegratedPeak } from "../../../lib/api";
import { regionsFromPeaks, type PeakRecipe } from "../../../lib/peakwizard";
import type { Dataset, MultiFitResult } from "../../../lib/types";
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";

export type IntegrateResult = { peaks: IntegratedPeak[]; total_area: number } | null;

interface Inputs {
  active: Dataset | null;
  segment: { x: number[]; gapCount: number; sourceCount: number } | null;
  workingY: number[] | null;
  /** The active engine's fitted peaks (null = none fitted yet). */
  fitted: { center: number; fwhm: number }[] | null;
  candidates: { center: number; fwhm: number; included: boolean }[];
  classicResult: MultiFitResult | null;
  modelResult: PeakModelFitResponse | null;
  report: PeakRecipe["report"];
  integrateResult: IntegrateResult;
  setIntegrateResult: (r: IntegrateResult) => void;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
}

/** The model fit's peaks as integration seeds (finite centre and FWHM only). */
export function modelPeaksForIntegrate(res: PeakModelFitResponse): { center: number; fwhm: number }[] {
  return res.peaks.flatMap((p) =>
    p.center !== null && p.fwhm !== null ? [{ center: p.center, fwhm: p.fwhm }] : []);
}

export function usePeakWizardOutput(inp: Inputs) {
  const { active, segment, workingY, fitted, candidates, classicResult, modelResult, report } = inp;
  const { integrateResult, setIntegrateResult, setBusy, setError } = inp;
  const addReport = useApp((s) => s.addReport);
  const [reportBusy, setReportBusy] = useState(false);

  // ⑤ Integrate-only path (#32): regions from the best peak positions we have.
  const runIntegrate = useCallback(async () => {
    if (!segment || !workingY) return;
    const source = fitted?.length ? fitted : candidates.filter((c) => c.included);
    if (source.length === 0) {
      setError("no peaks to integrate — find or fit peaks first");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (segment.x.length === 0) throw new Error("no finite X/Y pairs are available to integrate");
      if (segment.gapCount > 0) {
        toast(`${segment.gapCount} of ${segment.sourceCount} rows are gaps; they were excluded from integration.`);
      }
      const regions = regionsFromPeaks(
        source.map((p) => ({ center: p.center, fwhm: p.fwhm })),
        report.regionWidth,
        segment.x[0],
        segment.x[segment.x.length - 1],
      );
      const res = await peaksIntegrate({ x: segment.x, y: workingY, regions });
      setIntegrateResult({ peaks: res.peaks, total_area: res.total_area });
    } catch (e) {
      setError(e instanceof Error ? e.message : "integration failed");
    } finally {
      setBusy(false);
    }
  }, [segment, workingY, fitted, candidates, report.regionWidth, setIntegrateResult, setBusy, setError]);

  // ⑤ Land the result as a #36 report (fit table or integration table).
  const toReport = useCallback(async () => {
    if (!active) return;
    setReportBusy(true);
    try {
      const refs = [{ kind: "dataset", id: active.id, name: active.name }];
      const title = `Peak analysis — ${active.name}`;
      if (report.mode === "integrate" && integrateResult) {
        const { report: sheet } = await reportEmit({
          kind: "integrate",
          result: integrateResult as unknown as Record<string, unknown>,
          title: `Peak integration — ${active.name}`,
          source_refs: refs,
        });
        addReport(`Peak integration — ${active.name}`, sheet, active.id);
      } else if (modelResult) {
        // The curves are plot data, not report content — the emitter ignores
        // them, so they are not shipped.
        const { curves: _curves, ...rest } = modelResult;
        const { report: sheet } = await reportEmit({
          kind: "peak_model_fit", result: rest as unknown as Record<string, unknown>,
          title, source_refs: refs,
        });
        addReport(title, sheet, active.id);
      } else if (classicResult) {
        const { report: sheet } = await reportEmit({
          kind: "multipeak_fit",
          result: classicResult as unknown as Record<string, unknown>,
          title,
          source_refs: refs,
        });
        addReport(title, sheet, active.id);
      }
    } catch (e) {
      toast(`could not add to report — ${e instanceof Error ? e.message : "unknown error"}`, "danger");
    } finally {
      setReportBusy(false);
    }
  }, [active, report.mode, integrateResult, modelResult, classicResult, addReport]);

  return { runIntegrate, reportBusy, toReport };
}
