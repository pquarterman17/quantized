// Curve Fit: the opt-in "preview initial guess" toggle and, while it is on, a
// stepper per parameter (fine ‹ › and coarse « » nudges of its start value).
// State and rules live in ./useFitPreview; this is the view.

import type { FitParamRow } from "../../../lib/fitParams";
import { nudgeStart, STEP_FRACTION, type StepSize } from "./fitPreviewSteps";
import type { FitPreviewState } from "./useFitPreview";

export interface FitPreviewControlsProps {
  on: boolean;
  setOn: (on: boolean) => void;
  state: FitPreviewState;
  rows: FitParamRow[];
  setRow: (index: number, patch: Partial<FitParamRow>) => void;
}

const STEPS: { dir: 1 | -1; size: StepSize; glyph: string }[] = [
  { dir: -1, size: "coarse", glyph: "«" },
  { dir: -1, size: "fine", glyph: "‹" },
  { dir: 1, size: "fine", glyph: "›" },
  { dir: 1, size: "coarse", glyph: "»" },
];

export default function FitPreviewControls({ on, setOn, state, rows, setRow }: FitPreviewControlsProps) {
  return (
    <div style={{ marginBottom: 8 }}>
      <label style={{ display: "flex", gap: 6, alignItems: "center" }} title="Draw the model at these start values on the plot as a dotted preview (never a fit result)">
        <input type="checkbox" checked={on} aria-label="Preview initial guess on the plot" onChange={(e) => setOn(e.target.checked)} />
        Preview initial guess on the plot
      </label>
      {on && state.message && (
        <div role="status" className="qzk-ds-meta" style={{ color: "var(--text-faint)", marginTop: 4 }}>
          {state.message}
        </div>
      )}
      {on && state.drawn && (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)", marginTop: 4 }}>
          Dotted “initial guess” curve: not a fit. Nudge: ‹ › {STEP_FRACTION.fine * 100} %, « » {STEP_FRACTION.coarse * 100} %.
        </div>
      )}
      {on &&
        state.effective &&
        rows.map((row, i) => {
          const value = state.effective![i];
          if (value === undefined) return null;
          return (
            <div key={row.name} style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 2 }}>
              <span style={{ flex: 1 }}>{row.name}</span>
              <span className="qz-num" style={{ fontFamily: "var(--font-mono)", minWidth: 72, textAlign: "right" }}>
                {Number(value.toPrecision(6))}
              </span>
              {STEPS.map((s) => (
                <button
                  key={s.glyph}
                  className="qz-btn"
                  aria-label={`${s.dir < 0 ? "Decrease" : "Increase"} ${row.name} (${s.size})`}
                  title={`${s.dir < 0 ? "Decrease" : "Increase"} the start value of ${row.name} by ${STEP_FRACTION[s.size] * 100} %`}
                  onClick={() => {
                    const next = nudgeStart(value, s.dir, s.size, row);
                    if (next !== null) setRow(i, { start: next });
                  }}
                >
                  {s.glyph}
                </button>
              ))}
            </div>
          );
        })}
    </div>
  );
}
