// Peak Analyzer wizard (#31) — the stepper frame. Origin's Peak Analyzer,
// re-imagined as a quantized workshop: five steps over the existing peak /
// baseline / fit calc, ending in a #36 report (or the #32 integrate-only
// path). All state lives in usePeakWizard so navigation never loses edits;
// clearing the overlays on close mirrors the Peaks workshop.
//
// "Batch" mode (audit P2.4 slice 4, ./PeakBatchView) runs a saved recipe over
// many datasets. Once opened it stays MOUNTED (hidden) while the wizard is
// shown, so switching modes never cancels a running batch or drops its table.

import { useState } from "react";

import ToolWindow from "../../overlays/ToolWindow";
import { Button, Select } from "../../primitives";
import { useApp } from "../../../store/useApp";
import {
  StepFindPeaks,
  StepFitReview,
  StepModel,
  StepRangeBaseline,
  StepReport,
} from "./steps";
import { usePeakWizard, WIZARD_STEPS } from "./usePeakWizard";
import PeakBatchView from "./PeakBatchView";

export default function PeakWizardPanel() {
  const setOpen = useApp((s) => s.setPeakWizardOpen);
  const setBaselineOverlay = useApp((s) => s.setBaselineOverlay);
  const setPeakOverlay = useApp((s) => s.setPeakOverlay);
  const w = usePeakWizard();
  const [mode, setMode] = useState<"wizard" | "batch">("wizard");
  const [batchOpened, setBatchOpened] = useState(false);
  const show = (m: "wizard" | "batch") => {
    setMode(m);
    if (m === "batch") setBatchOpened(true);
  };

  const close = () => {
    w.model.clear(); // the model engine's curve + in-flight request
    setBaselineOverlay(null);
    setPeakOverlay(null);
    setOpen(false);
  };

  const stepBody = [
    <StepRangeBaseline key={`s0-${w.recipeRev}`} w={w} />,
    <StepFindPeaks key={`s1-${w.recipeRev}`} w={w} />,
    <StepModel key={`s2-${w.recipeRev}`} w={w} />,
    <StepFitReview key={`s3-${w.recipeRev}`} w={w} />,
    <StepReport key={`s4-${w.recipeRev}`} w={w} />,
  ][w.step];

  return (
    <ToolWindow id="peakwizard" title="Peak Analyzer" width={420} onClose={close}>
      <div role="tablist" aria-label="Peak Analyzer mode" style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        {(["wizard", "batch"] as const).map((m) => (
          <Button key={m} size="sm" role="tab" aria-selected={mode === m} variant={mode === m ? "primary" : "default"} onClick={() => show(m)}>
            {m === "wizard" ? "Wizard" : "Batch"}
          </Button>
        ))}
      </div>
      {batchOpened && (
        <div hidden={mode !== "batch"}>
          <PeakBatchView recipes={w.recipes} current={w.recipe.name} />
        </div>
      )}
      {mode === "batch" ? null : !w.active ? (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          Select a dataset to analyze.
        </div>
      ) : (
        <>
          {/* Step chips: click to jump (state persists across steps). */}
          <div className="qzk-wizard-steps">
            {WIZARD_STEPS.map((label, i) => (
              <button
                key={label}
                className={`qzk-wizard-step${i === w.step ? " qzk-active" : ""}`}
                onClick={() => w.setStep(i)}
              >
                <span className="qzk-wizard-num">{i + 1}</span> {label}
              </button>
            ))}
          </div>

          {w.recipes.length > 0 && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
              <span className="qzk-field-lbl" style={{ margin: 0 }}>
                Recipe
              </span>
              <Select
                options={[
                  { value: "", label: "—" },
                  ...w.recipes.map((r) => ({ value: r.name, label: r.name })),
                ]}
                value=""
                onChange={(e) => e.target.value && w.applyRecipe(e.target.value)}
              />
            </div>
          )}

          <div style={{ marginTop: 10 }}>{stepBody}</div>

          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <Button size="sm" disabled={w.step === 0} onClick={w.back}>
              ← Back
            </Button>
            <span style={{ flex: 1 }} />
            <Button
              size="sm"
              variant="primary"
              disabled={w.step === WIZARD_STEPS.length - 1}
              onClick={w.next}
            >
              Next →
            </Button>
          </div>
        </>
      )}
    </ToolWindow>
  );
}
