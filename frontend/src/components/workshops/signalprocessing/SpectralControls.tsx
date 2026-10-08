import type { Dispatch, SetStateAction } from "react";

import type { SpectralOperation } from "../../../lib/spectralWorkbench";
import { Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import { NumberField } from "../../primitives/NumberField";
import { frequencyUnitOf, type SpectralUiSettings } from "./spectralSettings";

type Setter = Dispatch<SetStateAction<SpectralUiSettings>>;

export default function SpectralControls({
  operation,
  settings,
  setSettings,
  xUnit,
}: {
  operation: SpectralOperation;
  settings: SpectralUiSettings;
  setSettings: Setter;
  xUnit: string;
}) {
  const set = <K extends keyof SpectralUiSettings>(key: K, value: SpectralUiSettings[K]) =>
    setSettings((current) => ({ ...current, [key]: value }));
  const frequencyUnit = frequencyUnitOf(xUnit);
  return (
    <div className="qz-spectral-controls">
      {operation === "fft" && (
        <>
          <label>Output
            <Select value={settings.outputType} onChange={(event) => set("outputType", event.target.value as SpectralUiSettings["outputType"])} options={[
              { value: "magnitude", label: "Magnitude" },
              { value: "psd", label: "Power spectral density" },
              { value: "phase", label: "Phase" },
            ]} />
          </label>
          <label>Sides
            <Select value={settings.sided} onChange={(event) => set("sided", event.target.value as SpectralUiSettings["sided"])} options={[
              { value: "one", label: "One-sided" },
              { value: "two", label: "Two-sided" },
            ]} />
          </label>
          <Checkbox checked={settings.welch} onChange={(checked) => setSettings((current) => ({ ...current, welch: checked, ...(checked ? { outputType: "psd" } : {}) }))}>
            Welch averaging
          </Checkbox>
          {settings.welch && (
            <>
              <label>Segment length <NumberField min={4} step={1} value={settings.segmentLen} onChange={(value) => set("segmentLen", value)} /></label>
              <label>Overlap <NumberField min={0} max={0.99} step={0.05} value={settings.overlap} onChange={(value) => set("overlap", value)} /></label>
            </>
          )}
          <label>Zero-pad to <NumberField min={0} step={1} value={settings.zeroPad} onChange={(value) => set("zeroPad", value)} /></label>
        </>
      )}
      {operation === "filter" && (
        <>
          <label>Filter
            <Select value={settings.filterType} onChange={(event) => set("filterType", event.target.value as SpectralUiSettings["filterType"])} options={[
              { value: "lowpass", label: "Low-pass" },
              { value: "highpass", label: "High-pass" },
              { value: "bandpass", label: "Band-pass" },
              { value: "notch", label: "Notch" },
            ]} />
          </label>
          <label>{settings.filterType === "bandpass" ? "Lower cutoff" : settings.filterType === "notch" ? "Center" : "Cutoff"}
            <NumberField min={0} value={settings.cutoffLow} unit={frequencyUnit} onChange={(value) => set("cutoffLow", value)} />
          </label>
          {settings.filterType === "bandpass" && <label>Upper cutoff <NumberField min={0} value={settings.cutoffHigh} unit={frequencyUnit} onChange={(value) => set("cutoffHigh", value)} /></label>}
          {settings.filterType === "notch" && <label>Bandwidth <NumberField min={0} value={settings.bandwidth} unit={frequencyUnit} onChange={(value) => set("bandwidth", value)} /></label>}
          <label>Order <NumberField min={1} max={20} step={1} value={settings.order} onChange={(value) => set("order", value)} /></label>
        </>
      )}
      {operation === "correlation" && (
        <Checkbox checked={settings.correlationDemean} onChange={(checked) => set("correlationDemean", checked)}>
          Subtract each signal mean before correlation
        </Checkbox>
      )}
      {operation !== "correlation" && (
        <>
          <label>Window
            <Select value={settings.window} onChange={(event) => set("window", event.target.value as SpectralUiSettings["window"])} options={[
              { value: "none", label: "None" },
              { value: "hanning", label: "Hann" },
              { value: "hamming", label: "Hamming" },
              { value: "blackman", label: "Blackman" },
              { value: "flattop", label: "Flat top" },
            ]} />
          </label>
          <label>Detrend
            <Select value={settings.detrend} onChange={(event) => set("detrend", event.target.value as SpectralUiSettings["detrend"])} options={[
              { value: "mean", label: "Remove mean" },
              { value: "linear", label: "Remove linear trend" },
              { value: "none", label: "None" },
            ]} />
          </label>
        </>
      )}
      <Checkbox checked={settings.useRange} onChange={(checked) => set("useRange", checked)}>
        Limit X range
      </Checkbox>
      {settings.useRange && (
        <div className="qz-spectral-range">
          <label>From <NumberField value={settings.xMin} unit={xUnit} onChange={(value) => set("xMin", value)} /></label>
          <label>To <NumberField value={settings.xMax} unit={xUnit} onChange={(value) => set("xMax", value)} /></label>
        </div>
      )}
      <Checkbox checked={settings.resample} onChange={(checked) => set("resample", checked)}>
        Resample an irregular monotonic X grid
      </Checkbox>
      <p className="qz-signal-note">Resampling is never automatic. Closed or repeated sweeps must be split before spectral analysis.</p>
    </div>
  );
}
