// Peaks workshop — view. A draggable ToolWindow listing detected peaks
// (center / height / FWHM / SNR) with markers on the plot via the store overlay
// (see usePeaks), plus fit controls: fit all peaks simultaneously (shared
// background) or each independently, then show the fitted parameters + R².
// "→ Report" lands the fitted peak table as a #36 report sheet in the library.

import { useState } from "react";

import PeakFitControls from "./PeakFitControls";
import PeakTable from "./PeakTable";
import { usePeakTableSelection } from "./peakSelection";
import { usePeaks } from "./usePeaks";
import ToolWindow from "../../overlays/ToolWindow";
import { Button } from "../../primitives";
import { reportEmit } from "../../../lib/api";
import { fmtNum } from "../../../lib/format";
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
        result: fitResult as unknown as Record<string, unknown>,
        title: `Peak fit — ${active.name}`,
        source_refs: [{ kind: "dataset", id: active.id, name: active.name }],
      });
      addReport(`Peak fit — ${active.name}`, report, active.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : "report failed", "danger");
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

  const fitRows = (fitResult?.peaks ?? []).map((p, i) => [
    i + 1,
    fmtNum(p.center),
    fmtNum(p.height),
    fmtNum(p.fwhm),
    fmtNum(p.area),
  ]);

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
          onFitTogether={fitTogether}
          onFitEach={fitEach}
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
            {fitResult.model} ·{" "}
            {fitResult.R2 == null ? "independent fits" : `R² = ${fmtNum(fitResult.R2)}`}
            {fitResult.rmse != null && ` · RMSE = ${fmtNum(fitResult.rmse)}`}
          </div>
          <PeakTable
            ariaLabel="fitted peaks"
            columns={["#", "center", "height", "FWHM", "area"]}
            rows={fitRows}
            selected={fittedSelection.selected}
            onSelect={fittedSelection.select}
          />
          <div style={{ marginTop: 8 }}>
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
