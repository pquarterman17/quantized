// The parameter fields of the wavelet sigop methods (sigopWaveletModel.ts).
// Pure view over `SigopForm`, rendered by SigopFields.

import { Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import { NumberField } from "../../primitives/NumberField";
import type { SigopForm } from "./sigopModel";
import {
  DISCRETE_WAVELETS,
  EXTENSION_MODES,
  levelTokens,
  type SigopWaveletMethod,
} from "./sigopWaveletModel";

interface Props {
  method: SigopWaveletMethod;
  form: SigopForm;
  set: (patch: Partial<SigopForm>) => void;
  xUnit: string;
}

const opts = (names: string[]) => names.map((n) => ({ value: n, label: n }));

function Field({ label, value, onChange, min, step, placeholder }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: number;
  step?: number | "any";
  placeholder?: string;
}) {
  return (
    <label>{label}
      <NumberField aria-label={label} min={min} step={step} value={value} placeholder={placeholder} onChange={onChange} />
    </label>
  );
}

/** One checkbox per component, A (approximation) then the detail levels coarse to fine. */
function LevelBoxes({ level, isOn, toggle, withApprox }: {
  level: number;
  isOn: (token: string) => boolean;
  toggle: (token: string) => void;
  withApprox: boolean;
}) {
  const tokens = [...(withApprox ? ["A"] : []), ...Array.from({ length: Math.min(level, 12) }, (_, i) => String(level - i))];
  return (
    <div className="qz-wavelet-levels" role="group" aria-label="Levels">
      {tokens.map((t) => (
        <Checkbox key={t} checked={isOn(t)} onChange={() => toggle(t)} ariaLabel={t === "A" ? "Approximation" : `Detail level ${t}`}>
          {t === "A" ? "Approx." : `D${t}`}
        </Checkbox>
      ))}
    </div>
  );
}

function toggled(list: string, token: string): string {
  const set = new Set(levelTokens(list));
  if (set.has(token)) set.delete(token);
  else set.add(token);
  return [...set].join(",");
}

function DiscreteFields({ form, set }: Pick<Props, "form" | "set">) {
  return (
    <>
      <label>Wavelet
        <Select aria-label="Wavelet" value={form.dwtWavelet} options={opts(DISCRETE_WAVELETS)} onChange={(e) => set({ dwtWavelet: e.target.value })} />
      </label>
      <Field label="Levels" min={1} step={1} value={form.dwtLevel} onChange={(dwtLevel) => set({ dwtLevel })} />
      <label>Edge extension
        <Select aria-label="Edge extension" value={form.dwtMode} options={opts(EXTENSION_MODES)} onChange={(e) => set({ dwtMode: e.target.value })} />
      </label>
    </>
  );
}

const FAMILIES = [
  { value: "morlet", label: "Morlet (complex)" },
  { value: "mexican-hat", label: "Mexican hat (Ricker)" },
  { value: "gaussian", label: "Gaussian derivative" },
];

export default function SigopWaveletFields({ method, form, set, xUnit }: Props) {
  const level = Number(form.dwtLevel);
  const levels = Number.isInteger(level) && level >= 1 ? level : 0;
  switch (method) {
    case "cwt": {
      const per = form.cwtAxis === "frequency" ? (xUnit ? ` (1/${xUnit})` : "") : " (samples)";
      return (
        <>
          <label>Wavelet
            <Select aria-label="Wavelet" value={form.cwtFamily} options={FAMILIES} onChange={(e) => set({ cwtFamily: e.target.value as SigopForm["cwtFamily"] })} />
          </label>
          {form.cwtFamily === "morlet" && (
            <>
              <Field label="Morlet bandwidth" min={0.1} step="any" value={form.cwtBandwidth} onChange={(cwtBandwidth) => set({ cwtBandwidth })} />
              <Field label="Morlet centre frequency" min={0.1} step="any" value={form.cwtCenter} onChange={(cwtCenter) => set({ cwtCenter })} />
            </>
          )}
          {form.cwtFamily === "gaussian" && <Field label="Derivative order (1 to 8)" min={1} step={1} value={form.cwtOrder} onChange={(cwtOrder) => set({ cwtOrder })} />}
          <label>Map axis
            <Select aria-label="Map axis" value={form.cwtAxis} options={[{ value: "frequency", label: "Frequency (from the X step)" }, { value: "scale", label: "Scale (samples)" }]} onChange={(e) => set({ cwtAxis: e.target.value as SigopForm["cwtAxis"] })} />
          </label>
          <Field label={`Minimum${per}`} min={0} step="any" placeholder="auto" value={form.cwtMin} onChange={(cwtMin) => set({ cwtMin })} />
          <Field label={`Maximum${per}`} min={0} step="any" placeholder="auto" value={form.cwtMax} onChange={(cwtMax) => set({ cwtMax })} />
          <Field label="Number of scales" min={2} step={1} value={form.cwtCount} onChange={(cwtCount) => set({ cwtCount })} />
          <label>Spacing
            <Select aria-label="Spacing" value={form.cwtSpacing} options={[{ value: "log", label: "Logarithmic" }, { value: "linear", label: "Linear" }]} onChange={(e) => set({ cwtSpacing: e.target.value as SigopForm["cwtSpacing"] })} />
          </label>
          <label>Output
            <Select aria-label="Output" value={form.cwtOutput} options={[{ value: "scalogram", label: "Scalogram map (|coefficients|)" }, { value: "ridge", label: "Ridge (strongest scale per X)" }]} onChange={(e) => set({ cwtOutput: e.target.value as SigopForm["cwtOutput"] })} />
          </label>
          <p className="qz-muted">Pick one signal column. Needs an increasing, uniform X. The scalogram is a map dataset (X by {form.cwtAxis}); blank limits mean automatic. Broad real wavelets (Mexican hat, Gaussian) smear the ridge; Morlet is the accurate one.</p>
        </>
      );
    }
    case "dwt":
      return (
        <>
          <DiscreteFields form={form} set={set} />
          <p className="qz-muted">One column per level: the approximation cA and the details cD, coarse to fine. Shorter levels are padded blank; the sheet records how to rebuild the signal. Needs a uniform X and no blank values.</p>
        </>
      );
    case "wavelet-reconstruct":
      return (
        <>
          <DiscreteFields form={form} set={set} />
          <LevelBoxes level={levels} withApprox isOn={(t) => !levelTokens(form.reconOff).includes(t)} toggle={(t) => set({ reconOff: toggled(form.reconOff, t) })} />
          <p className="qz-muted">Rebuilds the signal from the ticked components only (the rest are set to zero). All ticked gives the input back.</p>
        </>
      );
    case "wavelet-smooth":
      return (
        <>
          <DiscreteFields form={form} set={set} />
          <LevelBoxes level={levels} withApprox={false} isOn={(t) => levelTokens(form.smoothZero).includes(t)} toggle={(t) => set({ smoothZero: toggled(form.smoothZero, t) })} />
          <p className="qz-muted">Tick the detail levels to remove; D1 is the finest. The approximation and the other levels are kept.</p>
        </>
      );
    case "wavelet-denoise":
      return (
        <>
          <DiscreteFields form={form} set={set} />
          <label>Threshold rule
            <Select aria-label="Threshold rule" value={form.denoiseRule} options={[{ value: "universal", label: "Universal (VisuShrink)" }, { value: "sure", label: "SURE (SureShrink)" }]} onChange={(e) => set({ denoiseRule: e.target.value as SigopForm["denoiseRule"] })} />
          </label>
          <label>Thresholding
            <Select aria-label="Thresholding" value={form.denoiseThreshold} options={[{ value: "soft", label: "Soft" }, { value: "hard", label: "Hard" }]} onChange={(e) => set({ denoiseThreshold: e.target.value as SigopForm["denoiseThreshold"] })} />
          </label>
          <label>Noise estimate
            <Select aria-label="Noise estimate" value={form.denoiseScope} options={[{ value: "global", label: "One value, from the finest level" }, { value: "per-level", label: "Per level (coloured noise)" }]} onChange={(e) => set({ denoiseScope: e.target.value as SigopForm["denoiseScope"] })} />
          </label>
          <p className="qz-muted">Noise σ = median |finest detail| / 0.6745. The estimated σ and thresholds are listed under the preview.</p>
        </>
      );
  }
}
