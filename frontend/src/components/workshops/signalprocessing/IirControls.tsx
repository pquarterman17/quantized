import type { Dispatch, SetStateAction } from "react";

import type { BesselNorm, IirBand, IirFamily } from "../../../lib/spectralIir";
import { Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import { NumberField } from "../../primitives/NumberField";
import { isBandBand, usesAttenuation, usesRipple } from "./iirSettings";
import type { SpectralUiSettings } from "./spectralSettings";

/** IIR design controls (scipy second-order sections) for the Frequency filter. */
export default function IirControls({ settings, setSettings, frequencyUnit }: {
  settings: SpectralUiSettings;
  setSettings: Dispatch<SetStateAction<SpectralUiSettings>>;
  frequencyUnit: string;
}) {
  const set = <K extends keyof SpectralUiSettings>(key: K, value: SpectralUiSettings[K]) =>
    setSettings((current) => ({ ...current, [key]: value }));
  const band = isBandBand(settings.iirBand);
  return (
    <>
      <label>Family
        <Select value={settings.iirFamily} onChange={(event) => set("iirFamily", event.target.value as IirFamily)} options={[
          { value: "butter", label: "Butterworth" },
          { value: "cheby1", label: "Chebyshev I" },
          { value: "cheby2", label: "Chebyshev II" },
          { value: "ellip", label: "Elliptic" },
          { value: "bessel", label: "Bessel" },
        ]} />
      </label>
      <label>Band
        <Select value={settings.iirBand} onChange={(event) => set("iirBand", event.target.value as IirBand)} options={[
          { value: "lowpass", label: "Low-pass" },
          { value: "highpass", label: "High-pass" },
          { value: "bandpass", label: "Band-pass" },
          { value: "bandstop", label: "Band-stop" },
        ]} />
      </label>
      <label>{band ? "Lower cutoff" : "Cutoff"}
        <NumberField min={0} value={settings.cutoffLow} unit={frequencyUnit} onChange={(value) => set("cutoffLow", value)} />
      </label>
      {band && <label>Upper cutoff <NumberField min={0} value={settings.cutoffHigh} unit={frequencyUnit} onChange={(value) => set("cutoffHigh", value)} /></label>}
      <label>Order <NumberField min={1} max={20} step={1} value={settings.order} onChange={(value) => set("order", value)} /></label>
      {usesRipple(settings.iirFamily) && <label>Pass-band ripple <NumberField min={0} value={settings.iirRp} unit="dB" onChange={(value) => set("iirRp", value)} /></label>}
      {usesAttenuation(settings.iirFamily) && <label>Stop-band attenuation <NumberField min={0} value={settings.iirRs} unit="dB" onChange={(value) => set("iirRs", value)} /></label>}
      {settings.iirFamily === "bessel" && (
        <label>Bessel normalization
          <Select value={settings.iirBesselNorm} onChange={(event) => set("iirBesselNorm", event.target.value as BesselNorm)} options={[
            { value: "phase", label: "Phase (-3 dB point moves)" },
            { value: "delay", label: "Delay (unit group delay)" },
            { value: "mag", label: "Magnitude (-3 dB at cutoff)" },
          ]} />
        </label>
      )}
      <Checkbox checked={settings.iirZeroPhase} onChange={(checked) => set("iirZeroPhase", checked)}>
        Zero-phase (forward-backward; squares the magnitude, no delay)
      </Checkbox>
      <p className="qz-signal-note">
        {settings.iirZeroPhase ? "Zero-phase filtering is non-causal: it uses future samples." : "Causal filtering delays the signal (see the phase plot)."}
        {" "}Cutoffs must lie below Nyquist. Chebyshev II and elliptic cutoffs are the stop-band and pass-band edges respectively.
      </p>
    </>
  );
}
