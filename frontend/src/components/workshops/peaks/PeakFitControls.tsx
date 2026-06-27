// Peaks workshop — fit controls sub-component. Picks the model + background
// degree + linked-width mode + center constraint, then runs either a
// simultaneous fit (all peaks share one background) or independent per-peak
// fits. Owns only its own form state; the actual fit lives in usePeaks.

import { useState } from "react";

import { Button, Checkbox, NumberField, Select } from "../../primitives";
import type { PeakFitOptions } from "./usePeaks";

const MODEL_OPTIONS = [
  { value: "Lorentzian", label: "Lorentzian" },
  { value: "Gaussian", label: "Gaussian" },
  { value: "Pseudo-Voigt", label: "Pseudo-Voigt" },
  { value: "Split Pearson VII", label: "Split Pearson VII" },
  { value: "TCH-pV", label: "TCH-pV" },
];

const LINK_OPTIONS = [
  { value: "None", label: "Independent widths" },
  { value: "Shared FWHM", label: "Shared FWHM" },
  { value: "Shared FWHM + eta", label: "Shared FWHM + η" },
];

interface Props {
  disabled: boolean;
  fitting: boolean;
  onFitTogether: (opts: PeakFitOptions) => void;
  onFitEach: (opts: PeakFitOptions) => void;
}

export default function PeakFitControls({ disabled, fitting, onFitTogether, onFitEach }: Props) {
  const [model, setModel] = useState("Lorentzian");
  const [bgDegree, setBgDegree] = useState(1);
  const [linkMode, setLinkMode] = useState("None");
  const [constrain, setConstrain] = useState(false);

  const opts = (): PeakFitOptions => ({ model, bgDegree, linkMode, constrain });
  const row: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 6,
  };
  const label: React.CSSProperties = {
    fontSize: "var(--font-size-sm)",
    color: "var(--text-faint)",
  };

  return (
    <div style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
      <div style={row}>
        <span style={label}>Model</span>
        <Select
          options={MODEL_OPTIONS}
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
      </div>
      <div style={row}>
        <span style={label}>Background degree</span>
        <NumberField
          value={bgDegree}
          width={56}
          type="number"
          min={0}
          max={6}
          onChange={(v) => {
            const n = Number.parseInt(v, 10);
            if (Number.isFinite(n)) setBgDegree(Math.min(6, Math.max(0, n)));
          }}
        />
      </div>
      <div style={row}>
        <span style={label}>Linked widths</span>
        <Select
          options={LINK_OPTIONS}
          value={linkMode}
          onChange={(e) => setLinkMode(e.target.value)}
        />
      </div>
      <div style={{ ...row, justifyContent: "flex-start" }}>
        <Checkbox checked={constrain} onChange={setConstrain}>
          <span style={label}>Constrain centers</span>
        </Checkbox>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <Button
          variant="primary"
          size="sm"
          disabled={disabled || fitting}
          onClick={() => onFitTogether(opts())}
        >
          {fitting ? "Fitting…" : "Fit all together"}
        </Button>
        <Button
          variant="default"
          size="sm"
          disabled={disabled || fitting}
          onClick={() => onFitEach(opts())}
        >
          Fit each
        </Button>
      </div>
    </div>
  );
}
