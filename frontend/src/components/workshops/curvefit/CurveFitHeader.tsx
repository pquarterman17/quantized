// Curve Fit's sticky header (UX-F, audit 7 finding 4): the model, the PRIMARY
// Fit button with the fit's status beside it, and the body tabs
// Setup · Results · Advanced. It is the ToolWindow's non-scrolling band, so
// after a fit the Fit button and the outcome stay in view however far the
// results scroll -- OriginPro's NLFit keeps the same persistent Fit bar over
// its tabbed settings.

import { useState, type ComponentProps, type ReactNode } from "react";

import { Button } from "../../primitives";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { onTabListKeyDown } from "../../../lib/tabListKeys";
import type { FitStatusTone } from "./curveFitStatus";
import ModelSelect from "./ModelSelect";

export type CurveFitTab = "setup" | "results" | "advanced";

export const CURVE_FIT_TABS: readonly { id: CurveFitTab; label: string }[] = [
  { id: "setup", label: "Setup" },
  { id: "results", label: "Results" },
  { id: "advanced", label: "Advanced" },
];

/** The id of a tab / its panel, for aria-controls and aria-labelledby. */
export const cfTabId = (t: CurveFitTab) => `qz-cf-tab-${t}`;
export const cfPanelId = (t: CurveFitTab) => `qz-cf-panel-${t}`;

const TONE_COLOR: Record<FitStatusTone, string> = {
  ok: "var(--text-dim)",
  warn: "var(--warn)",
  danger: "var(--danger)",
  dim: "var(--text-faint)",
};

/** One tab's panel: hidden, never unmounted, once shown -- a running batch or
 *  an open report survives a tab switch. A `lazy` panel renders nothing until its
 *  tab is first shown, so its lazy chunks load only then. */
export function CurveFitTabPanel({ id, tab, lazy = false, children }: { id: CurveFitTab; tab: CurveFitTab; lazy?: boolean; children: ReactNode }) {
  const [seen, setSeen] = useState(tab === id);
  if (tab === id && !seen) setSeen(true);
  return (
    <div className="qz-cf-panel" role="tabpanel" id={cfPanelId(id)} aria-labelledby={cfTabId(id)} hidden={tab !== id}>
      {!lazy || seen ? children : null}
    </div>
  );
}

/** The model row: label, the Global fit toggle and the model picker. */
export function CurveFitModelPicker({
  globalMode,
  onGlobalMode,
  ...select
}: ComponentProps<typeof ModelSelect> & { globalMode: boolean; onGlobalMode: () => void }) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <label className="qzk-field-lbl" style={{ margin: 0 }}>Model</label>
        <Button
          size="sm"
          variant={globalMode ? "primary" : "ghost"}
          aria-pressed={globalMode}
          title="Fit one model to several series with shared parameters"
          onClick={onGlobalMode}
        >
          Global fit
        </Button>
      </div>
      <ModelSelect {...select} />
    </>
  );
}

export interface CurveFitHeaderProps {
  /** Model label row + picker (shared with the global and equation modes). */
  modelPicker: ReactNode;
  /** The fit range line under the Fit bar (./FitRangeBar). */
  range?: ReactNode;
  /** The registry-model fit bar; absent in modes that carry their own. */
  fit?: {
    disabled: boolean;
    /** A fit (not an auto-guess) is running: the button says so. */
    fitting: boolean;
    onGuess: () => void;
    onFit: () => void;
    status: { text: string; tone: FitStatusTone };
    tab: CurveFitTab;
    onTab: (t: CurveFitTab) => void;
    /** "Fit N worksheets": expand the batch section (it may be mounted, collapsed). */
    onOpenBatch?: () => void;
  };
}

export default function CurveFitHeader({ modelPicker, range, fit }: CurveFitHeaderProps) {
  // Several worksheets in scope: Fit means the batch, which lives in Advanced
  // (opened with the model already chosen), not a silent fit of the active one.
  const scope = useAnalysisSelection((s) => (s.toolId === "curvefit" ? s.selection?.items.length ?? 0 : 0));
  const batch = scope >= 2;
  return (
    <>
      {modelPicker}
      {fit && (
        <div className="qz-cf-fitbar">
          <Button
            variant="primary"
            className="qz-cf-fit"
            disabled={fit.disabled}
            title={batch
              ? `Open the batch: fit ${scope} worksheets with this model (Run is one click away)`
              : "Fit the model to the selected data (the result opens in the Results tab)"}
            onClick={batch ? () => (fit.onOpenBatch?.(), fit.onTab("advanced")) : fit.onFit}
          >
            {fit.fitting ? "Fitting…" : batch ? `Fit ${scope} worksheets` : "Fit"}
          </Button>
          {batch && (
            <Button size="sm" variant="ghost" disabled={fit.disabled} title="Fit only the active worksheet, not the batch (the result opens in the Results tab)" onClick={fit.onFit}>
              {fit.fitting ? "Fitting…" : "Fit active only"}
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={fit.disabled} title="Fill the start values from the data without fitting" onClick={fit.onGuess}>
            Auto-guess
          </Button>
          <span className="qz-cf-status" role="status" title={fit.status.text} style={{ color: TONE_COLOR[fit.status.tone] }}>
            {fit.status.text}
          </span>
        </div>
      )}
      {range}
      {fit && (
        // Roving tablist, AUTOMATIC activation: every panel stays mounted (a
        // running batch or an open report survives a tab switch), so it is cheap.
        <div className="qz-cf-tabs" role="tablist" aria-label="Curve Fit sections" onKeyDown={(e) => onTabListKeyDown(e, true)}>
          {CURVE_FIT_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={cfTabId(t.id)}
              aria-selected={fit.tab === t.id}
              aria-controls={cfPanelId(t.id)}
              tabIndex={fit.tab === t.id ? 0 : -1}
              className={`qzk-tab${fit.tab === t.id ? " active" : ""}`}
              onClick={() => fit.onTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
