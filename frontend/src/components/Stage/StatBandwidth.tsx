// The KDE bandwidth pick of the ridgeline and the half / split violin (plan item 20): a rule
// ("scott" or "silverman") or a free positive factor, scipy's scalar `bw_method` (it multiplies the
// sample's standard deviation; smaller = wigglier). The pick is saved as text: a rule's name, or the
// factor spelled as a number.

import { Select } from "../primitives";
import BufferedNumberField from "../primitives/BufferedNumberField";

const RULES = [
  { value: "scott", label: "scott" },
  { value: "silverman", label: "silverman" },
  { value: "factor", label: "factor…" },
];
export const DEFAULT_FACTOR = 0.3;
const isRule = (bw: string) => bw === "scott" || bw === "silverman";

export default function BandwidthPicker({ value, onChange }: { value: string; onChange: (bw: string) => void }) {
  return (
    <>
      <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
        bandwidth
        <Select
          options={RULES}
          value={isRule(value) ? value : "factor"}
          onChange={(e) => onChange(e.target.value === "factor" ? String(isRule(value) ? DEFAULT_FACTOR : value) : e.target.value)}
        />
      </label>
      {!isRule(value) && (
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }} title="Multiplies the group's standard deviation: smaller is wigglier">
          factor
          <BufferedNumberField
            value={Number(value)} required min={0.001} max={100} width={56}
            onValue={(v) => v != null && onChange(String(v))}
          />
        </label>
      )}
    </>
  );
}
