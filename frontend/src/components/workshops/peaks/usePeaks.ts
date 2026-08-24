// Peaks workshop — state hook. Auto-finds peaks in the active dataset's first
// channel via /api/peaks/find and pushes markers into the store as a plot
// overlay. Also exposes two fit actions over the detected peaks: fitTogether
// (simultaneous /api/peaks/fit-multi) and fitEach (independent /api/peaks/fit
// per peak). Re-runs find — and clears any fit — when the active dataset changes.
//
// fitEach per-peak progress + cancel (P0.4 feedback/cancel audit tail,
// 2026-07-26): a serial loop of N sequential round-trips had one static
// "Fitting…" for the whole batch and no way to stop it. It now registers ONE
// pendingOps entry (store/pendingOps.ts) whose label ticks "Fitting peak
// i/N…" per iteration — StatusBar renders that label AND, because a `cancel`
// callback is attached, a Cancel affordance next to it automatically (no new
// UI here). Cancel semantics mirror the import batch (store/importDatasets.ts
// `runImport`, P3.4 slice 1): it stops the loop before the NEXT peak starts,
// peaks already fit keep their results — never a rollback, never an abort of
// the in-flight request (each per-peak fit is a small windowed NLLS call, not
// worth wiring an AbortSignal through `fitPeak` for).

import { useCallback, useEffect, useState } from "react";

import { findPeaks, fitMultiPeak, fitPeak, type PeakSeed } from "../../../lib/api/peaks";
import { selectedFitData } from "../../../lib/fitselection";
import { fullPlottedX } from "../../../lib/fitselectionActions";
import { placeLabels, renderLabelTemplate, DEFAULT_LABEL_TEMPLATE } from "../../../lib/peakLabels";
import { peakOverlayArray } from "../../../lib/plotdata";
import { analysisData } from "../../../lib/rowstate";
import type { Dataset, FittedPeak, MultiFitResult, Peak } from "../../../lib/types";
import { askParams } from "../../overlays/ParamDialog";
import { beginOp, endOp, updateOp } from "../../../store/pendingOps";
import { toast } from "../../../store/toasts";
import { useActiveDataset, useApp } from "../../../store/useApp";

// Local id sequence for a "Label peaks" run's shared `Annotation.groupId`
// (MY RULING 2) — same `Date.now().toString(36)` + module-scoped counter
// shape as every other id generator in the store (e.g. useApp.ts's
// `nextFigureId`/`_annSeq`), kept local here since group ids for this
// feature are minted nowhere else.
let _labelGroupSeq = 0;
function nextLabelGroupId(): string {
  return `peak-labels-${Date.now().toString(36)}-${++_labelGroupSeq}`;
}

/** A finite [lo, hi] from a value array, looping rather than
 *  `Math.min(...arr)` (a 100k+-point array blows the call-arity cap — see
 *  useBaseline.ts's own comment on the same hazard). Falls back to `[0, 1]`
 *  when nothing finite is present, so a degenerate/empty channel never
 *  produces a NaN range for `placeLabels`.
 *
 *  `positiveOnly` (P3 review finding, round 6): matches `lib/uplotOpts.ts`'s
 *  own `fullYExtents`/`isPositiveOnlyScale` convention — a log/reciprocal
 *  axis can only ever render (and therefore only ever legitimately span)
 *  POSITIVE values, so its floor must be the SMALLEST POSITIVE sample, not
 *  the channel's raw minimum. Without this, a single zero or slightly
 *  negative background sample — routine in real XRD data — made
 *  `finiteRange(y)[0] <= 0`, and `placeLabels`'s own transform then failed
 *  to establish a transformed range at all, silently reverting the WHOLE
 *  batch to linear offsets (the exact ~2.7-decade misplacement
 *  `peakLabels.test.ts`'s own log tests exist to prevent) — not an edge
 *  case, the COMMON case for real data. */
function finiteRange(values: readonly number[], positiveOnly = false): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (Number.isFinite(v) && (!positiveOnly || v > 0)) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : [0, 1];
}

/** L5 review finding: `withHistoryBatch` folds ANY caller into whichever
 *  batch happens to already be in flight — not just a genuinely nested call
 *  from the SAME operation (see history.ts's `withHistoryBatch`: its
 *  reentrant check is keyed only on "is a batch running", not on caller
 *  identity). Reachable from the UI: `relink.ts`'s `importChangedAsNewVersion`
 *  (and `reimportAllRun.ts`'s bulk re-import) call `withHistoryBatch` with a
 *  real internal `await` (`importPaths`'s network round trips), and nothing
 *  disables the rest of the app — including an already-open Peaks panel —
 *  while that's in flight. Without this guard, labeling mid-import would
 *  silently ride the import's ONE undo entry: a single Ctrl+Z would revert
 *  the import AND delete every label. Same pre-flight-check + toast shape as
 *  `commands/fileCommands.ts`'s `rejectIfImportRunning` (`isImportRunning`,
 *  store/importDatasets.ts) — a cooperative, not a hard, lock: it narrows
 *  the window rather than eliminating it (see the two call sites below). */
function rejectIfHistoryBatchRunning(): boolean {
  if (!useApp.getState().historySuppressed) return false;
  toast("Another operation is in progress — try Label peaks again in a moment.", "danger");
  return true;
}

export interface PeakFitOptions {
  model: string;
  bgDegree: number;
  linkMode: string;
  constrain: boolean;
}

export interface PeaksState {
  active: Dataset | null;
  peaks: Peak[];
  busy: boolean;
  error: string | null;
  fitResult: MultiFitResult | null;
  fitting: boolean;
  fitError: string | null;
  fitTogether: (opts: PeakFitOptions) => Promise<void>;
  fitEach: (opts: PeakFitOptions) => Promise<void>;
  /** UX-R6 beta half (plans/ORIGIN_REPLACEMENT_ONE_WEEK_SPRINT.md) — "Label
   *  peaks": turn the FITTED peaks (if a fit result exists) or the DETECTED
   *  ones into ordinary, independently editable annotations (MY RULING 1),
   *  sharing one `groupId` (RULING 2), folded into ONE undo entry (RULING
   *  3). Prompts for a token template + decimal precision via `askParams`;
   *  a cancelled dialog or an empty peak set creates nothing (RULING 7's
   *  guard). Never mutates the dataset or `fitResult` (RULING 4) — reads
   *  them only to compute label text and initial placement. */
  labelPeaks: () => Promise<void>;
}

/** The (x, y) the peak tools DETECT/FIT on — the PLOTTED X + primary Y over the
 *  analysis view (audit P1 #1), so peaks track what the user sees and excluded/
 *  filtered rows (#50/#53) don't produce or bias peaks. `fullX` is the same
 *  channel's FULL column, for aligning marker overlays to the full-length plot
 *  x. Falls back to the first channel when nothing is plotted. */
export function peakInputs(
  ds: Dataset,
  xKey: number | null,
  yKeys: number[] | null,
  seriesOrder: number[] | null,
): { x: number[]; y: number[]; fullX: number[] } {
  const fullX = fullPlottedX(ds.data, xKey);
  const sel = selectedFitData(ds, xKey, yKeys, seriesOrder);
  if (sel) return { x: sel.x, y: sel.y, fullX };
  const d = analysisData(ds) ?? ds.data;
  return { x: d.time, y: d.values.map((row) => row[0]), fullX };
}

function seedsFrom(peaks: Peak[]): PeakSeed[] {
  return peaks.map((p) => ({ center: p.center, fwhm: p.fwhm, height: p.height }));
}

export function usePeaks(): PeaksState {
  const active = useActiveDataset();
  const setPeakOverlay = useApp((s) => s.setPeakOverlay);
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const [peaks, setPeaks] = useState<Peak[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fitResult, setFitResult] = useState<MultiFitResult | null>(null);
  const [fitting, setFitting] = useState(false);
  const [fitError, setFitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPeaks([]);
    setError(null);
    setFitResult(null); // a new dataset invalidates any prior fit
    setFitError(null);
    if (!active) {
      setPeakOverlay(null);
      return;
    }
    setBusy(true);
    const activeId = active.id;
    void (async () => {
      try {
        // #38 deferred edge: auto-find must never run on the small preview —
        // resolve the active dataset's full data first (no-op if it isn't
        // pending).
        const ds = await useApp.getState().resolveDataset(activeId);
        if (cancelled || !ds) return;
        const { x, y, fullX } = peakInputs(ds, xKey, yKeys, seriesOrder);
        const res = await findPeaks({ x, y });
        if (cancelled) return;
        setPeaks(res.peaks);
        // Overlay on the FULL plotted x (not the pruned x) so markers align with
        // the full-length plot; peak centers land on their nearest full-x point.
        // L2 (review, latent pre-existing bug this work surfaced): `p.height`
        // is measured ABOVE `p.bg` (see `Peak`'s doc, lib/types.ts) — the
        // marker's actual y is `height + bg`, same as `overlayFitted` below
        // already does for fitted peaks. Left as bare `p.height` here, every
        // detected-peak marker on a backgrounded dataset (e.g. any real XRD
        // pattern) drew a whole background below the actual peak.
        setPeakOverlay({
          datasetId: ds.id,
          y: peakOverlayArray(fullX, res.peaks.map((p) => ({ center: p.center, height: p.height + p.bg }))),
        });
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "peak find failed");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, setPeakOverlay, xKey, yKeys, seriesOrder]);

  // Draw fitted peak tops (height above the local background) as the overlay,
  // on the FULL plotted x so markers align with the full-length plot x.
  const overlayFitted = useCallback(
    (ds: Dataset, fitted: FittedPeak[], fullX: number[]) => {
      setPeakOverlay({
        datasetId: ds.id,
        y: peakOverlayArray(fullX, fitted.map((p) => ({ center: p.center, height: p.height + p.bg }))),
      });
    },
    [setPeakOverlay],
  );

  const fitTogether = useCallback(
    async (opts: PeakFitOptions) => {
      if (!active || peaks.length === 0) {
        setFitError("Find peaks before fitting.");
        return;
      }
      setFitting(true);
      setFitError(null);
      try {
        // #38 deferred edge: resolve the active dataset's full data before
        // fitting (a no-op if it isn't pending).
        const ds = await useApp.getState().resolveDataset(active.id);
        if (!ds) return;
        const st = useApp.getState();
        const { x, y, fullX } = peakInputs(ds, st.xKey, st.yKeys, st.seriesOrder);
        const res = await fitMultiPeak({
          x, y, peaks: seedsFrom(peaks), model: opts.model,
          bg_degree: opts.bgDegree, constrain: opts.constrain, link_mode: opts.linkMode,
        });
        setFitResult(res);
        overlayFitted(ds, res.peaks, fullX);
      } catch (e: unknown) {
        setFitError(e instanceof Error ? e.message : "simultaneous fit failed");
      } finally {
        setFitting(false);
      }
    },
    [active, peaks, overlayFitted],
  );

  const fitEach = useCallback(
    async (opts: PeakFitOptions) => {
      if (!active || peaks.length === 0) {
        setFitError("Find peaks before fitting.");
        return;
      }
      setFitting(true);
      setFitError(null);
      const total = peaks.length;
      const label = (i: number) => `Fitting peak ${i + 1}/${total}…`;
      let cancelled = false;
      const opId = beginOp(label(0), () => {
        cancelled = true;
      });
      try {
        // #38 deferred edge: resolve the active dataset's full data before
        // fitting (a no-op if it isn't pending).
        const ds = await useApp.getState().resolveDataset(active.id);
        if (!ds) return;
        const st = useApp.getState();
        const { x, y, fullX } = peakInputs(ds, st.xKey, st.yKeys, st.seriesOrder);
        const fitted: FittedPeak[] = [];
        for (let i = 0; i < peaks.length; i++) {
          if (cancelled) break;
          updateOp(opId, label(i));
          const p = peaks[i];
          const half = (Number.isFinite(p.fwhm) && p.fwhm > 0 ? p.fwhm : 1) * 3;
          const r = await fitPeak({
            x, y, x_lo: p.center - half, x_hi: p.center + half,
            seed_center: p.center, seed_fwhm: p.fwhm, model: opts.model,
          });
          if (r.success) {
            fitted.push({
              center: r.center, fwhm: r.fwhm, height: r.height, bg: r.bg,
              eta: r.eta, area: r.area, status: "fitted", model: r.model,
            });
          }
        }
        const result: MultiFitResult = {
          peaks: fitted, bgCoeffs: [], R2: null, rmse: null,
          nPeaks: fitted.length, model: opts.model,
        };
        setFitResult(result);
        if (fitted.length > 0) overlayFitted(ds, fitted, fullX);
        // A deliberate cancel with zero completed peaks isn't a failure to report.
        if (fitted.length === 0 && !cancelled) {
          setFitError("No peaks could be fit individually.");
        }
      } catch (e: unknown) {
        setFitError(e instanceof Error ? e.message : "per-peak fit failed");
      } finally {
        endOp(opId);
        setFitting(false);
      }
    },
    [active, peaks, overlayFitted],
  );

  const labelPeaks = useCallback(async () => {
    if (!active) return;
    // L5: refuse up front if another history batch (e.g. an in-flight
    // "import as a new version") is already running — see
    // `rejectIfHistoryBatchRunning`'s doc for why this is reachable and why
    // it's a cooperative pre-flight check, not a hard lock.
    if (rejectIfHistoryBatchRunning()) return;

    // RULING 7: FITTED peaks when a fit result exists, otherwise DETECTED —
    // never both, never a user-driven selection (no row-selection exists on
    // DataTable today; booked as a follow-up in the UX-R6 status note).
    const source: { center: number; height: number; fwhm: number; area: number | null; bg: number }[] =
      fitResult && fitResult.peaks.length > 0 ? fitResult.peaks : peaks;
    if (source.length === 0) {
      toast("Find (or fit) peaks before labeling.", "danger");
      return;
    }

    const values = await askParams("Label peaks", [
      {
        key: "template",
        label: "Template",
        type: "text",
        default: DEFAULT_LABEL_TEMPLATE,
        hint: "{center} {height} {fwhm} {area} {index} — unknown tokens pass through literally",
      },
      { key: "precision", label: "Decimals", type: "number", default: 2 },
    ]);
    if (!values) return; // cancelled — creates nothing (RULING 7's guard)

    // L3: match the sibling fit actions' (fitTogether/fitEach) error-
    // surfacing pattern — every entry point calls this with `void`, so an
    // uncaught rejection here would fail utterly silently (no labels, no
    // toast, nothing).
    try {
      const template =
        typeof values.template === "string" && values.template.trim().length > 0
          ? values.template
          : DEFAULT_LABEL_TEMPLATE;
      const precisionRaw = Number(values.precision);
      // L4: clamp BOTH ends. `toFixed` throws `RangeError` above 100 (in
      // practice anything past ~10 is unreadable anyway) — an unclamped
      // high value used to silently abort the whole run (see L3 above).
      const precision = Number.isFinite(precisionRaw)
        ? Math.min(10, Math.max(0, Math.round(precisionRaw)))
        : 2;

      // #38 deferred edge: resolve the active dataset's full data (a no-op
      // if it isn't pending) before reading the plotted x/y ranges
      // placement is based on — never the RAW dataset in a way that could
      // be mutated; this is a READ ONLY lookup (RULING 4).
      const ds = await useApp.getState().resolveDataset(active.id);
      // M4 review finding: this used to be a bare silent return — unlike
      // every other failure path in this action (the L3 try/catch below,
      // the empty-source/blank-template guards), a dataset that stops
      // resolving while the dialog was open flipped the button back from
      // "Labeling…" with zero feedback. Toast, same as the rest.
      if (!ds) {
        toast("Could not load the dataset to label — try again.", "danger");
        return;
      }
      const st = useApp.getState();
      const { x, y } = peakInputs(ds, st.xKey, st.yKeys, st.seriesOrder);
      // N3 review finding: use the LIVE view (xLim/yLim), not the full
      // data range, when the user has zoomed in — placement was computed
      // against the FULL data range regardless of zoom, so a small percent-
      // of-full-range offset could exceed the entire visible window at any
      // real zoom level; `annotationPlugin` then skips the resulting
      // off-canvas annotation, so the run reported success while the user
      // saw nothing. Falls back to the full data range exactly as before
      // when the axis is on autoscale (`xLim`/`yLim` null) — P3: on a
      // log/reciprocal axis, that fallback is POSITIVE-only, matching how
      // the plot's own scale picks its floor (`fullYExtents`,
      // lib/uplotOpts.ts) — an explicit `yLim` is trusted as-is (a real
      // log-scaled view can never legitimately hold a non-positive bound).
      const yNeedsPositive = st.yScale === "log" || st.yScale === "reciprocal";
      const xRange = st.xLim ?? finiteRange(x);
      const yRange = st.yLim ?? finiteRange(y, yNeedsPositive);

      // L1 CRITICAL (review): a peak's apex y is `height + bg`, NEVER
      // `height` alone — `height` is measured ABOVE background by the
      // backend for BOTH sources (`calc/peaks.py`'s `find_peaks_robust`
      // AND the fit routines). `overlayFitted` above already applies this
      // for the fitted-peak marker overlay; `labelPeaks` must use the same
      // formula for both branches, or every label on a backgrounded
      // dataset (i.e. any real XRD pattern) lands far below the peak it
      // names.
      const rendered = source.map((p, i) => ({
        label: renderLabelTemplate(template, p, i, precision),
        point: { x: p.center, y: p.height + p.bg },
      }));

      // L7: a template that renders blank for a peak (e.g. `{area}` on a
      // detected peak — always `area: null` — or `{fwhm}` on a
      // fit-in-progress placeholder) must never create an invisible blank
      // annotation. If EVERY peak's label comes out blank, create nothing
      // at all — no annotations, no undo entry either.
      const kept = rendered.filter((r) => r.label.trim().length > 0);
      if (kept.length === 0) {
        toast("Nothing to label — the template rendered blank for every peak.", "danger");
        return;
      }

      const labels = kept.map((r) => r.label);
      const points = kept.map((r) => r.point);
      // O3 review finding: a log intensity axis is the STANDARD XRD view
      // this feature targets — pass the live `yScale` so offsets are
      // computed as a sensible visual distance on THAT scale, not always
      // linear data units (a linear offset near a log axis's top decade is
      // negligible; the same offset near a weak peak can be several
      // decades too tall).
      const placements = placeLabels(points, labels, xRange, yRange, st.yScale);

      // RULING 1/2/3: ordinary annotations via addAnnotation +
      // updateAnnotation (never a new decoration model), one shared groupId
      // for the run, the whole batch folded into ONE undo entry via
      // withHistoryBatch.
      const groupId = nextLabelGroupId();
      const historyLabel = `label ${kept.length} peak${kept.length === 1 ? "" : "s"}`;
      // P4 review finding, round 6: the ONLY re-check that matters is the one
      // immediately before withHistoryBatch itself, with NO await between
      // check and call — resolveDataset above is a real async round trip
      // (#38 deferred edge), and another batch (e.g. relink.ts's
      // importChangedAsNewVersion) can start at any point during it. A check
      // placed earlier (e.g. right after the dialog closes, before
      // resolveDataset) leaves that entire fetch window unguarded: a batch
      // starting mid-fetch would still make it all the way to
      // withHistoryBatch and get folded into the import's single undo entry
      // — exactly what L5 exists to prevent. Every synchronous step between
      // this check and the call below (peakInputs/finiteRange/placeLabels)
      // has no await, so this is the last possible moment to catch it.
      if (rejectIfHistoryBatchRunning()) return;
      await useApp.getState().withHistoryBatch(historyLabel, async (token) => {
        const store = useApp.getState();
        for (let i = 0; i < kept.length; i++) {
          const pos = placements[i] ?? points[i];
          const id = store.addAnnotation(pos.x, pos.y, labels[i], token);
          store.updateAnnotation(id, { groupId }, token);
        }
      });
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : "labeling peaks failed", "danger");
    }
  }, [active, peaks, fitResult]);

  return { active, peaks, busy, error, fitResult, fitting, fitError, fitTogether, fitEach, labelPeaks };
}
