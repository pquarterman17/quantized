// Peaks workshop — view. A draggable ToolWindow listing detected peaks
// (center / height / FWHM / SNR) with markers on the plot via the store overlay
// (see usePeaks), plus fit controls: fit all peaks simultaneously (shared
// background) or each independently, then show the fitted parameters + R².
// "→ Report" lands the fitted peak table as a #36 report sheet in the library.
//
// Audit P2.1: the fitted table is DURABLE — a fit is saved onto the dataset
// (`Dataset.peakTable`, lib/peakTable.ts), so it survives a dataset switch, a
// panel close, and a `.dwk` save/reopen, and each row carries an "incl."
// checkbox whose state travels with it. Williamson-Hall's "Use fitted peaks"
// reads that same table and honours the exclusions set here. A table the Peak
// Analyzer's model fit published carries standard errors: its cells read
// "value ± error" (PeakValueCell), and the header names that producer.

import { useState } from "react";

import PeakFitControls from "./PeakFitControls";
import PeakTable from "./PeakTable";
import PeakValueCell from "./PeakValueCell";
import { peakReportResult } from "./peakReport";
import { usePeakTableSelection } from "./peakSelection";
import { usePeaks } from "./usePeaks";
import ToolWindow from "../../overlays/ToolWindow";
import { askParams } from "../../overlays/ParamDialog";
import { Button } from "../../primitives";
import { reportEmit } from "../../../lib/api";
import { fmtNum } from "../../../lib/format";
import { manualEditCount, peakManualEditProblem } from "../../../lib/peakTableFit";
import type { FittedPeak } from "../../../lib/types";
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";

// Stable empty-array reference (peak-selection RULING 2) — `fitResult?.peaks
// ?? []` written inline here would mint a NEW [] every render while
// fitResult is null. usePeakTableSelection now TOLERATES that specific
// empty-vs-empty case (its own `bothEmpty` backstop, N3 review finding) so
// it no longer crashes — but a fresh literal here would still cost an extra
// wasted render pass on every keystroke elsewhere in the panel, which this
// stable constant avoids entirely. Prefer it; don't rely on the backstop.
const NO_FITTED_PEAKS: FittedPeak[] = [];

export default function PeaksPanel() {
  const setOpen = useApp((s) => s.setPeaksOpen);
  const setPeakOverlay = useApp((s) => s.setPeakOverlay);
  const addReport = useApp((s) => s.addReport);
  const [reporting, setReporting] = useState(false);
  const [labeling, setLabeling] = useState(false);
  const {
    active,
    peaks,
    busy,
    error,
    fitResult,
    peakTable,
    toggleExcluded,
    editFittedPeak,
    removeFittedPeaks,
    fitting,
    fitError,
    fitTogether,
    fitEach,
    labelPeaks,
  } = usePeaks();

  const close = () => {
    setPeakOverlay(null); // remove the markers when the panel closes
    setOpen(false);
  };

  const toReport = async () => {
    if (!fitResult || !active) return;
    setReporting(true);
    try {
      const { report } = await reportEmit({
        kind: "multipeak_fit",
        // A published model-fit table's errors and objective ride along, so
        // the report says what the table shows (./peakReport).
        result: peakReportResult(fitResult, entries, peakTable),
        title: `Peak fit — ${active.name}`,
        source_refs: [{ kind: "dataset", id: active.id, name: active.name }],
      });
      addReport(`Peak fit — ${active.name}`, report, active.id);
    } catch (e) {
      toast(`could not add to report — ${e instanceof Error ? e.message : "unknown error"}`, "danger");
    } finally {
      setReporting(false);
    }
  };

  const hasFit = fitResult != null && fitResult.peaks.length > 0;
  const labelSource = hasFit ? fitResult.peaks : peaks;
  const labelKind = hasFit ? "fitted" : "detected";

  // Peak-selection follow-up (RULINGS 1-3): one selection per table, each
  // scoped to the array that currently backs it — see peakSelection.ts's
  // header for why RULING 2's reset is keyed on THIS array's reference, and
  // NO_FITTED_PEAKS's comment for why the fallback must be a stable const.
  //
  // `governs` (K1 review finding): the two tables are mutually exclusive as
  // a labeling SOURCE — only one ever backs "Label peaks" (`hasFit` picks
  // it, same as `labelKind`/`labelSource` below) — so the LOSING table's
  // hook-level selection must clear the instant it stops governing, not
  // merely be masked at render time; see peakSelection.ts's own doc for why
  // a mask-only fix would let a stale pick resurrect if governance flips
  // back (e.g. a fit that lands zero peaks).
  const detectedSelection = usePeakTableSelection(peaks, !hasFit);
  const fittedSelection = usePeakTableSelection(fitResult?.peaks ?? NO_FITTED_PEAKS, hasFit);
  // The selection that governs "Label peaks" is whichever table matches the
  // CURRENT labelKind — the same fitted-over-detected choice `labelSource`
  // already makes, so the button always acts on the table it's naming.
  const activeSelection = hasFit ? fittedSelection.selected : detectedSelection.selected;
  const selectedCount = activeSelection.size;

  const runLabelPeaks = async () => {
    setLabeling(true);
    try {
      // RULING 3: an existing selection narrows to just those peaks; an
      // empty selection (the default) keeps labeling every peak in
      // `labelSource` — `labelPeaks` itself treats a zero-size Set the same
      // as `undefined`, so passing it unconditionally is safe either way.
      await labelPeaks(activeSelection);
    } finally {
      setLabeling(false);
    }
  };

  const rows = peaks.map((p, i) => [
    i + 1,
    fmtNum(p.center),
    fmtNum(p.height),
    fmtNum(p.fwhm),
    fmtNum(p.localSNR),
  ]);

  // The durable table (audit P2.1) is index-aligned with `fitResult.peaks` —
  // one is built from the other (lib/peakTable) — so row i's `excluded` flag
  // and durable id come from `peakTable.peaks[i]`.
  //
  // PAIRED, NOT ASSUMED (review round 2). `peakTable` is a REACTIVE store read
  // while `fitResult` is local state written inside usePeaks' effect, so on a
  // dataset switch the paint that happens BEFORE that effect has dataset B's
  // table beside dataset A's fitted rows. Positional `peakTable?.peaks[i]`
  // then handed row i of A's numbers B's durable id and `excluded` flag — one
  // frame, but a click in it would have excluded a peak in the wrong table.
  // Require the table to be THIS dataset's and to have the same row count
  // before pairing at all; otherwise no checkbox renders for that one frame,
  // which is the honest answer rather than a wrong one.
  //
  // ONE SOURCE FOR THE NUMBERS (2026-09-26). Once paired, every value cell and
  // the header metrics read the DURABLE table, never `fitResult` — the local
  // copy usePeakManualEdits re-derives from the table only after an async
  // resolve. Reading the copy let a hand edit of FWHM or height, or a table
  // published from the Peak Analyzer, show the OLD value beside the NEW row's
  // error for that interval. `fitResult` still drives what the table cannot:
  // the unpublished-fit case, and the row selection (whose reset is keyed on
  // that array's identity).
  const entries =
    peakTable &&
    peakTable.provenance.datasetId === active?.id &&
    peakTable.peaks.length === (fitResult?.peaks.length ?? -1)
      ? peakTable.peaks
      : null;
  const shown = entries ?? fitResult?.peaks ?? [];
  const metrics = entries && peakTable ? peakTable.provenance : fitResult;
  // Errors are shown only for a table that measured them (a model fit's).
  const modelFit = entries !== null && peakTable?.provenance.producer === "model_fit";
  const fitRows = shown.map((p, i) => {
    const entry = entries?.[i];
    const errOf = modelFit ? entry : undefined;
    return [
      i + 1,
      <PeakValueCell key="c" value={p.center} field="center" entry={errOf} />,
      <PeakValueCell key="h" value={p.height} field="height" entry={errOf} />,
      <PeakValueCell key="w" value={p.fwhm} field="fwhm" entry={errOf} />,
      <PeakValueCell key="a" value={p.area} field="area" entry={errOf} />,
      entry ? (
        <input
          type="checkbox"
          // Checked = INCLUDED, so the common case is a row of ticks and an
          // exclusion reads as a gap. The label names the peak, because a bare
          // "include" repeated N times is useless to a screen reader.
          aria-label={`include peak ${i + 1}`}
          checked={!entry.excluded}
          // The row itself is a selection target (PeakTable's onSelect); without
          // this, ticking a box would also move the peak selection. KEYBOARD
          // TOO (review round 2): the row's own onKeyDown calls
          // `preventDefault()` on " "/"Enter" and selects, so Space on a
          // focused checkbox cancelled the browser's own toggle AND moved the
          // selection — the box was a Tab stop that did nothing except the one
          // thing the mouse path is careful to prevent. Stopping the key here
          // leaves the native activation (which fires onChange) untouched.
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === " " || e.key === "Enter") e.stopPropagation();
          }}
          onChange={(e) => toggleExcluded(entry.id, !e.target.checked)}
        />
      ) : null,
    ];
  });
  const excludedCount = entries?.filter((p) => p.excluded).length ?? 0;

  const editSelectedPeak = async () => {
    if (!entries || fittedSelection.selected.size !== 1) return;
    const index = [...fittedSelection.selected][0];
    const entry = entries[index];
    if (!entry) return;
    const values = await askParams(`Edit fitted peak ${index + 1}`, [
      { key: "center", label: "Center", type: "number", default: entry.center },
      { key: "fwhm", label: "FWHM", type: "number", default: entry.fwhm },
      { key: "height", label: "Height", type: "number", default: entry.height },
      { key: "area", label: "Area", type: "number", default: entry.area },
    ]);
    if (!values) return;
    const patch = {
      center: Number(values.center),
      fwhm: Number(values.fwhm),
      height: Number(values.height),
      area: Number(values.area),
    };
    const problem = peakManualEditProblem(patch, entry);
    if (problem) {
      toast(problem, "danger");
      return;
    }
    await editFittedPeak(entry.id, patch);
  };

  const removeSelectedPeaks = async () => {
    if (!entries || fittedSelection.selected.size === 0) return;
    const ids = new Set(
      [...fittedSelection.selected]
        .map((index) => entries[index]?.id)
        .filter((id): id is string => typeof id === "string"),
    );
    await removeFittedPeaks(ids);
  };

  const faint = { color: "var(--text-faint)" } as const;

  return (
    <ToolWindow id="peaks" title="Peaks" width={360} onClose={close}>
      {!active && (
        <div className="qzk-ds-meta" style={faint}>
          Select a dataset to find peaks.
        </div>
      )}
      {active && busy && <div className="qzk-ds-meta">Finding peaks…</div>}
      {active && error && (
        <div className="qzk-ds-meta" style={{ color: "var(--danger)" }}>
          {error}
        </div>
      )}
      {active && !busy && !error && peaks.length === 0 && (
        <div className="qzk-ds-meta" style={faint}>
          No peaks found.
        </div>
      )}
      {rows.length > 0 && (
        <PeakTable
          ariaLabel="detected peaks"
          columns={["#", "center", "height", "FWHM", "SNR"]}
          rows={rows}
          selected={detectedSelection.selected}
          // K1: this table renders WHENEVER peaks exist, independent of
          // `hasFit` — but it only GOVERNS while `!hasFit` (see the
          // `usePeakTableSelection` calls above). Omitting `onSelect`
          // while a fit exists makes PeakTable itself render it inert
          // (no aria-selected, no highlight, no tab stop, no handler) —
          // exactly the "never look selected while ignored" contract.
          onSelect={hasFit ? undefined : detectedSelection.select}
        />
      )}

      {active && (
        <PeakFitControls
          disabled={peaks.length === 0}
          fitting={fitting}
          onFitTogether={(opts) => void fitTogether(opts)}
          onFitEach={(opts) => void fitEach(opts)}
        />
      )}

      {fitError && (
        <div className="qzk-ds-meta" style={{ color: "var(--danger)", marginTop: 6 }}>
          {fitError}
        </div>
      )}

      {fitResult && fitResult.peaks.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="qzk-ds-meta" style={{ ...faint, marginBottom: 4 }}>
            {metrics?.model} ·{" "}
            {metrics?.R2 != null
              ? `R² = ${fmtNum(metrics.R2)}`
              : !entries
                ? "" // table not yet paired with this fit (one frame on a switch)
                : peakTable?.provenance.method === "independent"
                  ? "independent fits"
                  : modelFit && peakTable?.provenance.ssr != null
                    ? "R² undefined" // an unedited model fit (SSR clears with R² on any edit)
                    : "fit metrics cleared by manual changes"}
            {modelFit && " · Peak Analyzer model fit"}
            {manualEditCount(shown) > 0 && ` · ${manualEditCount(shown)} edited by hand`}
            {metrics?.rmse != null && ` · RMSE = ${fmtNum(metrics.rmse)}`}
            {excludedCount > 0 && ` · ${excludedCount} excluded`}
          </div>
          <PeakTable
            ariaLabel="fitted peaks"
            columns={["#", "center", "height", "FWHM", "area", "incl."]}
            rows={fitRows}
            selected={fittedSelection.selected}
            onSelect={fittedSelection.select}
          />
          <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Button
              size="sm"
              disabled={fittedSelection.selected.size !== 1}
              onClick={() => void editSelectedPeak()}
            >
              Edit selected…
            </Button>
            <Button
              size="sm"
              disabled={fittedSelection.selected.size === 0}
              onClick={() => void removeSelectedPeaks()}
            >
              Remove selected
            </Button>
            <Button size="sm" disabled={reporting} onClick={() => void toReport()}>
              {reporting ? "Reporting…" : "→ Report"}
            </Button>
          </div>
        </div>
      )}

      {active && !busy && labelSource.length > 0 && (
        <div style={{ marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
          <div className="qzk-ds-meta" style={{ ...faint, marginBottom: 4 }}>
            Turns {labelKind} peaks into ordinary, editable annotations.
          </div>
          <Button size="sm" disabled={labeling} onClick={() => void runLabelPeaks()}>
            {labeling
              ? "Labeling…"
              // RULING 3: name the SELECTED count when a selection exists;
              // otherwise keep the established "all N ..." default text
              // unchanged (never silently switch defaults).
              : selectedCount > 0
                ? `Label ${selectedCount} selected ${labelKind} peak${selectedCount === 1 ? "" : "s"}…`
                : `Label all ${labelSource.length} ${labelKind} peak${labelSource.length === 1 ? "" : "s"}…`}
          </Button>
        </div>
      )}
    </ToolWindow>
  );
}
