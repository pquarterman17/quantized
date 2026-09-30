// Peaks workshop ▸ Advanced — the peak detector's settings behind a
// disclosure: sensitivity, SNR/prominence thresholds, peak-width limits and
// the detector's own background (SNIP window, or a robust polynomial). Edits
// are a local draft; "Find again" applies them (one request per apply, not
// one per keystroke), "Defaults" restores the backend's and re-finds.

import { useState } from "react";

import BufferedNumberField from "../../primitives/BufferedNumberField";
import { Checkbox } from "../../primitives/Checkbox";
import { Button, Select } from "../../primitives";
import { DEFAULT_PEAK_FIND, type PeakFindParams } from "./peakFindParams";

type NumKey = { [K in keyof PeakFindParams]: PeakFindParams[K] extends number ? K : never }[keyof PeakFindParams];

interface NumSpec {
  key: NumKey;
  label: string;
  hint: string;
  min: number;
  int?: boolean;
}

const THRESHOLDS: NumSpec[] = [
  { key: "snr_threshold", label: "SNR threshold", hint: "Minimum peak height over the noise.", min: 0 },
  { key: "min_prominence", label: "Min prominence", hint: "Fraction of the tallest peak a peak must stand out by.", min: 0 },
  { key: "max_peaks", label: "Max peaks", hint: "Keep at most this many peaks.", min: 1, int: true },
  { key: "min_separation", label: "Min separation", hint: "Closest allowed peak spacing, in x units.", min: 0 },
  { key: "min_width_deg", label: "Min width", hint: "Narrowest accepted FWHM, in x units.", min: 0 },
  { key: "max_width_deg", label: "Max width", hint: "Widest accepted FWHM, in x units.", min: 0 },
];

const SNIP_WINDOW: NumSpec = {
  key: "max_window_deg", label: "SNIP window", hint: "SNIP clipping window in x units (at least 5% of the x span).", min: 0,
};
const POLY_DEGREE: NumSpec = {
  key: "bg_poly_degree", label: "Polynomial degree", hint: "Degree of the robust background polynomial.", min: 0, int: true,
};

const SENSITIVITY = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];
const BACKGROUND = [
  { value: "snip", label: "SNIP" },
  { value: "polynomial", label: "Polynomial" },
];

const row: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 };
const label: React.CSSProperties = { fontSize: "var(--font-size-sm)", color: "var(--text-faint)" };

interface Props {
  value: PeakFindParams;
  onApply: (p: PeakFindParams) => void;
  busy: boolean;
}

export default function PeakFindAdvanced({ value, onApply, busy }: Props) {
  const [draft, setDraft] = useState<PeakFindParams>(value);
  // A new `value` (the caller applied or reset the settings) replaces the
  // draft DURING the render that carries it, never from a post-commit
  // effect: the effect form also ran once on mount, after the chunk's first
  // commit, and an edit typed into that gap was silently reset (measured
  // 1/20 under load in the Peak Analyzer's step ② test, 2026-09-30).
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }
  const set = <K extends keyof PeakFindParams>(k: K, v: PeakFindParams[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const numRow = (s: NumSpec) => (
    <div key={s.key} style={row} title={s.hint}>
      <span style={label}>{s.label}</span>
      <BufferedNumberField
        aria-label={s.label}
        type="number"
        width={64}
        min={s.min}
        step={s.int ? 1 : "any"}
        required
        value={draft[s.key]}
        onValue={(v) => {
          if (v !== undefined) set(s.key, s.int ? Math.round(v) : v);
        }}
      />
    </div>
  );

  return (
    <details style={{ marginTop: 8 }}>
      <summary style={{ ...label, cursor: "default" }}>Advanced</summary>
      <div style={{ marginTop: 6 }}>
        <div style={row} title="Loosens or tightens the SNR and prominence thresholds.">
          <span style={label}>Sensitivity</span>
          <Select
            aria-label="Sensitivity"
            options={SENSITIVITY}
            value={draft.sensitivity}
            onChange={(e) => set("sensitivity", e.target.value as PeakFindParams["sensitivity"])}
          />
        </div>
        {THRESHOLDS.map(numRow)}
        <div style={row} title="The detector's background under the peaks.">
          <span style={label}>Background</span>
          <Select
            aria-label="Background"
            options={BACKGROUND}
            value={draft.bg_method}
            onChange={(e) => set("bg_method", e.target.value as PeakFindParams["bg_method"])}
          />
        </div>
        {numRow(draft.bg_method === "snip" ? SNIP_WINDOW : POLY_DEGREE)}
        <div style={row}>
          <Checkbox
            checked={draft.bg_iterative}
            onChange={(v) => set("bg_iterative", v)}
            title="Mask the peaks and re-estimate the background."
          >
            <span style={label}>Refine background</span>
          </Checkbox>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <Button size="sm" disabled={busy} onClick={() => onApply(draft)}>
            Find again
          </Button>
          <Button size="sm" disabled={busy} onClick={() => onApply({ ...DEFAULT_PEAK_FIND })}>
            Defaults
          </Button>
        </div>
      </div>
    </details>
  );
}
