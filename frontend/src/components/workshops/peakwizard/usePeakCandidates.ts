// Step ② of the Peak Wizard: the candidate peaks — auto-find, include/exclude,
// manual add, remove — plus click-on-plot marker editing (interaction plan
// item 5) and the marker overlay. Extracted from usePeakWizard.ts (audit P2.4
// slice 3): that file sat at 467 lines against the 500-line ceiling, and
// direct add + model-table delete + keeping the model's edits with their
// peaks had to be funded by a split, the same move usePeakBaseline.ts and
// usePeakWizardOutput.ts made before it. This hook is the sole owner of
// `candidates`; everything here was already one concern.
//
// DIRECT ADD (slice 3). `addPeakAt(x)` — a plot click, the bridge's onAdd, or
// the "add peak at x =" field — seeds the new candidate from the data around
// x (lib/peakSeed's `seedPeakNear`: snap to a nearby apex unless the click is
// on a slope, half-maximum FWHM), and the model table picks it up as the
// next `p{i}` (it is appended, so no existing peak is renumbered).
//
// EDITS FOLLOW THEIR PEAK. The model table's user edits are keyed `p{i}` by
// INCLUDED-peak index (lib/peakRecipeFit.ts). Every operation that moves an
// included peak's index tells the wizard: removing (x) or excluding a peak
// shifts later peaks down (`peakLeft`; an EXCLUDED peak's own edits are set
// aside by its stable candidate `id`), re-including shifts them up and puts
// its edits back (`peakJoined`). A wholesale new list (Find peaks) keeps the
// edits by index — the recipe semantic.

import { useCallback, useEffect, useRef, useState } from "react";

import { visiblePeakMarkers } from "../../../lib/peakMarkerHit";
import { seedPeakNear } from "../../../lib/peakSeed";
import { baselineValueAt, plotApexY } from "../../../lib/peakWizardApex";
import type { PeakRecipe } from "../../../lib/peakwizard";
import { fullPlottedX } from "../../../lib/fitselectionActions";
import { peakOverlayArray } from "../../../lib/plotdata";
import type { Dataset, Peak } from "../../../lib/types";
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import { recipeFind } from "./recipeSteps";

/** A peak candidate on step ②: detected or manually added, toggleable.
 *  `height`/`bg` match `Peak`/`FittedPeak` (lib/types.ts) — apex =
 *  `height + bg` — but relative to `workingY` (the baseline-subtracted
 *  trace `findPeaks` runs on), not the plot's raw coordinates; see
 *  `plotApexY`'s doc for the term that maps back onto the plot. A manually
 *  added peak (`addPeakAt`) gets `bg: 0` — no detector background to
 *  separate out for it. */
export interface CandidatePeak {
  /** Stable for the session (never reused): what an excluded peak's
   *  set-aside model edits are keyed by. */
  id: number;
  center: number;
  height: number;
  bg: number;
  fwhm: number;
  included: boolean;
  manual: boolean;
}

/** The wizard's working segment (usePeakWizard builds it). */
export interface CandidateSegment {
  x: number[];
  gapCount: number;
  sourceCount: number;
}

interface Inputs {
  active: Dataset | null;
  step: number;
  segment: CandidateSegment | null;
  workingY: number[] | null;
  baseline: (number | null)[] | null;
  find: PeakRecipe["find"];
  xKey: number | null;
  /** A Find replaced the candidate set: downstream results are stale. */
  onReplaced: () => void;
  /** Included peak `k` (candidate `id`) left the model; `ids` are the included
   *  candidate ids BEFORE. `keep`: set its edits aside (an exclusion). Stable. */
  peakLeft: (k: number, id: number, ids: readonly number[], keep: boolean) => void;
  /** Candidate `id` joined the model as peak `k`; `ids` are the included ids
   *  AFTER. Stable. */
  peakJoined: (k: number, id: number, ids: readonly number[]) => void;
}

let nextCandidateId = 1;
const includedIds = (cs: readonly CandidatePeak[]): number[] => cs.filter((c) => c.included).map((c) => c.id);

/** How many INCLUDED candidates precede candidate `i` (its model index). */
const includedIndex = (cs: readonly CandidatePeak[], i: number): number =>
  cs.slice(0, i).filter((c) => c.included).length;

export function usePeakCandidates(inp: Inputs) {
  const { active, step, segment, workingY, baseline, find, xKey, onReplaced, peakLeft, peakJoined } = inp;
  const setPeakOverlay = useApp((s) => s.setPeakOverlay);
  const setPeakWizardEdit = useApp((s) => s.setPeakWizardEdit);
  const [candidates, setCandidates] = useState<CandidatePeak[]>([]);
  const [findBusy, setFindBusy] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);
  // Click-on-plot marker editing (item 5): Escape pauses the mode without
  // leaving step ②; re-entering the step (or any step change and back) resets
  // it, so the pause never outlives the step it was raised on.
  const [editSuppressed, setEditSuppressed] = useState(false);

  // The ops below read and write the list through this ref so each one can
  // tell the wizard which INCLUDED index moved (a functional setState updater
  // must stay pure, so the remap cannot live inside one), and so two ops in
  // one tick still see each other's result.
  const listRef = useRef(candidates);
  listRef.current = candidates;
  const commit = useCallback((next: CandidatePeak[]) => {
    listRef.current = next;
    setCandidates(next);
  }, []);

  // ② Find peaks on the corrected segment; markers overlay on the full x.
  const runFind = useCallback(async () => {
    if (!active || !segment || !workingY) return;
    setFindBusy(true);
    setFindError(null);
    try {
      if (segment.x.length === 0) throw new Error("no finite X/Y pairs are available to analyze");
      if (segment.gapCount > 0) {
        toast(`${segment.gapCount} of ${segment.sourceCount} rows are gaps; they were excluded from peak analysis.`);
      }
      // Shared with the batch runner (./recipeSteps).
      const found = await recipeFind(segment.x, workingY, find);
      commit(found.map((p: Peak) => ({
        id: nextCandidateId++,
        center: p.center, height: p.height, bg: p.bg, fwhm: p.fwhm, included: true, manual: false,
      })));
      onReplaced();
    } catch (e) {
      setFindError(e instanceof Error ? e.message : "peak find failed");
    } finally {
      setFindBusy(false);
    }
  }, [active, segment, workingY, find, commit, onReplaced]);

  // Keep the marker overlay in sync with the included candidates. M3
  // review finding (same latent bug as usePeaks.ts's L1/L2, third call
  // site): a raw `p.height` is NOT the plot apex — see
  // lib/peakWizardApex.ts's doc; `plotApexY`/`baselineValueAt` map it back.
  useEffect(() => {
    if (!active || candidates.length === 0) return;
    const included = candidates.filter((c) => c.included);
    setPeakOverlay({
      datasetId: active.id,
      y: peakOverlayArray(
        fullPlottedX(active.data, xKey),
        included.map((p) => ({
          center: p.center,
          height: plotApexY(p.height, p.bg, baselineValueAt(p.center, segment?.x ?? [], baseline)),
        })),
      ),
    });
  }, [active, candidates, setPeakOverlay, xKey, segment, baseline]);

  const togglePeak = (i: number) => {
    const cs = listRef.current;
    const c = cs[i];
    if (!c) return;
    const k = includedIndex(cs, i);
    const next = cs.map((x, j) => (j === i ? { ...x, included: !x.included } : x));
    if (c.included) peakLeft(k, c.id, includedIds(cs), true);
    else peakJoined(k, c.id, includedIds(next));
    commit(next);
  };
  // R9: memoized (not plain closures) so their identity — and therefore the
  // `peakWizardEdit` bridge effect below that lists them as deps — stays
  // STABLE across a re-render that changes neither `segment`/`workingY` nor
  // `candidates`. PlotViewport.tsx's create effect keys off `peakWizardEdit`
  // and rebuilds the WHOLE uPlot instance on any identity change, so an
  // unrelated re-render (e.g. patching an unrelated recipe field) must never
  // manufacture a new bridge object — see usePeakWizard.test.ts's "does not
  // push a new peakWizardEdit bridge on an unrelated re-render" regression.
  const removePeak = useCallback((i: number) => {
    const cs = listRef.current;
    if (!cs[i]) return;
    if (cs[i].included) peakLeft(includedIndex(cs, i), cs[i].id, includedIds(cs), false);
    commit(cs.filter((_, j) => j !== i));
  }, [peakLeft, commit]);
  const addPeakAt = useCallback(
    (at: number) => {
      if (!segment || !workingY || segment.x.length === 0) return;
      const seed = seedPeakNear(segment.x, workingY, at);
      if (!seed) return;
      // Appended: it becomes the LAST included peak, so no index moves.
      commit([...listRef.current, { id: nextCandidateId++, ...seed, bg: 0, included: true, manual: true }]);
    },
    [segment, workingY, commit],
  );
  /** Delete the model's peak `k` (its k-th INCLUDED candidate) — the model
   *  table's per-peak "×", the same removal as step ②'s. */
  const removeModelPeak = (k: number) => {
    let seen = -1;
    const i = listRef.current.findIndex((c) => c.included && ++seen === k);
    if (i >= 0) removePeak(i);
  };

  // Click-on-plot marker editing (interaction item 5, deferred from closed
  // gap #31): live only while step ② is showing, a dataset is active, and
  // Escape hasn't paused it. `addPeakAt`/`removePeak` above are the SAME
  // functions the manual "+ Add" field and the candidate table's "×" button
  // use — no parallel state model. The store only carries a thin, disposable
  // projection (visible marker positions + these two callbacks) so
  // PlotStage's plugin can hit-test a click without its own copy of the list.
  const markerEditActive = step === 1 && !!active && !editSuppressed;

  // Escape pauses the mode (mirrors useGadgetChip's Escape-to-dismiss) without
  // navigating away from step ②; re-entering the step below un-pauses it.
  //
  // `preventDefault()` is the repo's "this keystroke was mine" convention
  // (useGlobalShortcuts' header documents it), and here it is load-bearing:
  // this panel is hosted by `ToolWindow`, whose Escape-to-close reads
  // `defaultPrevented` once the dispatch is over. Without the claim, one
  // Escape would pause the marker-edit mode AND close the whole Peak Analyzer.
  // The listener is mounted only while there is something to pause, so a
  // SECOND Escape (mode already paused) claims nothing and closes the panel as
  // usual.
  useEffect(() => {
    if (step !== 1 || !active || editSuppressed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      setEditSuppressed(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, active, editSuppressed]);

  // Any step change resets the pause — so it never outlives the visit to ②
  // that raised it, and returning to ② always starts un-paused.
  useEffect(() => {
    setEditSuppressed(false);
  }, [step]);

  // Push the current bridge into the store whenever markerEditActive,
  // candidates, or addPeakAt/removePeak's own identity change (R9) — so a
  // stale segment/workingY closure can never desync `addPeakAt` from the
  // manual "+ Add" field, WITHOUT re-pushing (forcing a full PlotViewport/
  // uPlot rebuild) on every unrelated re-render; unmount always clears it.
  // M3: hit-test markers use the SAME `plotApexY` mapping the overlay draw
  // above uses — a click must land on what's actually drawn.
  useEffect(() => {
    setPeakWizardEdit(
      markerEditActive
        ? {
            // N4: only INCLUDED candidates pay for the linear-scan baseline
            // lookup below (excluded ones' `height` is never read); the array
            // itself stays full-length since `removePeak(index)` depends on
            // ORIGINAL indices.
            markers: visiblePeakMarkers(
              candidates.map((c) =>
                c.included
                  ? { ...c, height: plotApexY(c.height, c.bg, baselineValueAt(c.center, segment?.x ?? [], baseline)) }
                  : c,
              ),
            ),
            addPeakAt,
            removePeak,
          }
        : null,
    );
  }, [markerEditActive, candidates, addPeakAt, removePeak, setPeakWizardEdit, segment, baseline]);
  useEffect(() => () => setPeakWizardEdit(null), [setPeakWizardEdit]);

  return {
    candidates,
    clearCandidates: () => commit([]),
    findBusy,
    findError,
    runFind,
    togglePeak,
    removePeak,
    removeModelPeak,
    addPeakAt,
    markerEditActive,
  };
}
