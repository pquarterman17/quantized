// A small labelled-NumberField wrapper, local to the ROI cuts workshop —
// every card below (Box/Sector) needs a handful of compact "label + number"
// controls (bounds, bins, phi/secondary ranges). Deliberately a tiny local
// copy rather than importing calculators/shared.tsx's Field: that helper is
// scoped to the calculator tabs, and each workshop keeping its own trivial
// version (see rsm/RsmPanel.tsx's inline label+NumberField pairs for the
// precedent this generalizes) avoids a cross-workshop coupling for six lines
// of JSX.

import { NumberField } from "../../primitives";

export default function Field({
  label,
  value,
  onChange,
  width = 64,
  title,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  width?: number;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }} title={title}>
      {label}
      <NumberField
        value={Number.isFinite(value) ? value : ""}
        width={width}
        disabled={disabled}
        onChange={(v) => onChange(Number(v) || 0)}
      />
    </label>
  );
}
