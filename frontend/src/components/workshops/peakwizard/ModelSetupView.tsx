// Peak Analyzer step ③ for the mixed-shape model engine (audit P2.4 slice 2):
// the engine choice, one shape per included peak, the background, the
// "share FWHM" convenience and the parameter table. The classic engine keeps
// its original controls in steps.tsx's StepModel.

import { fmtNum } from "../../../lib/format";
import { Button, Select } from "../../primitives";
import ModelParamTable from "./ModelParamTable";
import { MODEL_BACKGROUNDS, MODEL_SHAPES, type ModelBackground, type ModelShape } from "./peakModelParams";
import type { FitEngine } from "./useModelFit";
import type { PeakWizardState } from "./usePeakWizard";

const faint = { color: "var(--text-faint)" } as const;

const ENGINES: { value: FitEngine; label: string }[] = [
  { value: "model", label: "Mixed-shape model (per-peak shapes, bounds, ties)" },
  { value: "classic", label: "Classic multi-peak (MATLAB parity)" },
];

export function EngineSelect({ w }: { w: PeakWizardState }) {
  return (
    <>
      <label className="qzk-field-lbl">Fit engine</label>
      <Select
        aria-label="fit engine"
        options={ENGINES}
        value={w.model.engine}
        onChange={(e) => w.model.setEngine(e.target.value as FitEngine)}
      />
    </>
  );
}

export default function ModelSetupView({ w }: { w: PeakWizardState }) {
  const m = w.model;
  const peaks = w.candidates.filter((c) => c.included);
  return (
    <>
      <EngineSelect w={w} />
      {peaks.length === 0 ? (
        <div className="qzk-ds-meta" style={{ ...faint, marginTop: 8 }}>
          Find or add peaks (step 2) to build the model.
        </div>
      ) : (
        <>
          <div style={{ marginTop: 8, maxHeight: 150, overflowY: "auto" }}>
            <table className="qz-table" aria-label="peak shapes">
              <thead>
                <tr>
                  <th>#</th>
                  <th>center</th>
                  <th>shape</th>
                </tr>
              </thead>
              <tbody>
                {peaks.map((c, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>{fmtNum(c.center)}</td>
                    <td>
                      <Select
                        aria-label={`peak ${i + 1} shape`}
                        options={MODEL_SHAPES}
                        value={m.setup.shapes[i] ?? "gaussian"}
                        onChange={(e) => m.setShape(i, e.target.value as ModelShape)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {m.shapeNote && (
            <div className="qzk-ds-meta" style={{ ...faint, marginTop: 4 }}>
              {m.shapeNote}
            </div>
          )}
          <div style={{ display: "flex", gap: 6, alignItems: "flex-end", marginTop: 8, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
              <label className="qzk-field-lbl">Background</label>
              <Select
                aria-label="background"
                options={MODEL_BACKGROUNDS}
                value={m.setup.background}
                onChange={(e) => m.setBackground(e.target.value as ModelBackground)}
              />
            </span>
            <Button
              size="sm"
              disabled={peaks.length < 2}
              title="tie every peak's width to the first peak's (only ties change)"
              onClick={m.toggleShareFwhm}
            >
              {m.fwhmShared ? "Unshare FWHM" : "Share FWHM across peaks"}
            </Button>
            <Button size="sm" variant="ghost" title="discard edits, back to the seeded defaults" onClick={m.resetSetup}>
              ↺ Defaults
            </Button>
          </div>
          <ModelParamTable model={m} />
          <div className="qzk-ds-meta" style={{ ...faint, marginTop: 6 }}>
            Seeded from the detected peaks; blank min/max = open (widths stay positive, η in [0, 1]).
          </div>
        </>
      )}
    </>
  );
}
