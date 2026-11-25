// Preferences ▸ Numbers (split out of PreferencesDialog.tsx, PREFS_AUDIT lane
// 1). Lane 3 (numbers, locale, stats) adds its rows here. Lazy with the dialog.

import { useApp } from "../../store/useApp";
import { Select } from "../primitives";
import { SliderRow } from "../primitives/SliderRow";
import PrefRow from "./PrefRow";

const NOTATION_OPTS = [
  { value: "auto", label: "Auto" },
  { value: "scientific", label: "Scientific" },
  { value: "fixed", label: "Fixed" },
];

export default function PrefsNumbersPane() {
  const sigFigs = useApp((s) => s.sigFigs);
  const notation = useApp((s) => s.notation);
  const setPref = useApp((s) => s.setPref);
  return (
    <>
      {/* P2-12: the slider spans the range the store and formatter accept (1 to 12). */}
      <PrefRow label="Significant figures">
        <div style={{ width: 160 }}>
          <SliderRow
            aria-label="Significant figures"
            label="sf"
            value={sigFigs}
            min={1}
            max={12}
            step={1}
            onChange={(v) => setPref("sigFigs", v)}
            format={(v) => String(v)}
          />
        </div>
      </PrefRow>
      <PrefRow label="Notation">
        <Select aria-label="Notation" options={NOTATION_OPTS} value={notation} onChange={(e) => setPref("notation", e.target.value)} />
      </PrefRow>
      <div className="qzk-pref-note">
        These apply to Inspector and readout values (fixed-width font, right-aligned), not to worksheet cells or plot
        axis ticks. Units keep their scientific casing (kOe, Å⁻¹, µ_B/f.u.).
      </div>
    </>
  );
}
