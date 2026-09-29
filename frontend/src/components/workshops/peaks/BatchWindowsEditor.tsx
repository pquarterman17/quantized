// Batch integrate — the integration-window list: typed lo/hi rows, seeded from
// the Peaks panel's peaks (center ± FWHM) or the plot's ROI band (the quick
// gadget's Integrate window), editable, removable.

import { Button } from "../../primitives";
import BufferedNumberField from "../../primitives/BufferedNumberField";
import type { IntegrateWindow } from "./batchIntegrate";

const faint = { color: "var(--text-faint)" } as const;

export default function BatchWindowsEditor({ windows, onChange, seed, roi, disabled }: {
  windows: IntegrateWindow[];
  onChange: (next: IntegrateWindow[]) => void;
  /** Windows from the panel's peaks; empty when it has none. */
  seed: IntegrateWindow[];
  /** The plot's ROI band, when one is drawn. */
  roi: [number, number] | null;
  disabled: boolean;
}) {
  const set = (k: number, patch: Partial<IntegrateWindow>) =>
    onChange(windows.map((w, i) => (i === k ? { ...w, ...patch } : w)));
  const val = (v: number) => (Number.isFinite(v) ? v : undefined);

  return (
    <div>
      <div className="qzk-field-lbl">Integration windows ({windows.length})</div>
      {windows.length === 0 && <div className="qzk-ds-meta" style={faint}>No windows yet.</div>}
      <div role="group" aria-label="integration windows">
        {windows.map((w, k) => (
          <div key={k} style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
            <span className="qzk-ds-meta" style={{ margin: 0, width: 18, fontFamily: "var(--font-mono)" }}>{k + 1}</span>
            <BufferedNumberField aria-label={`window ${k + 1} low`} value={val(w.lo)} width={80}
              disabled={disabled} onValue={(v) => set(k, { lo: v ?? Number.NaN })} />
            <span style={faint}>–</span>
            <BufferedNumberField aria-label={`window ${k + 1} high`} value={val(w.hi)} width={80}
              disabled={disabled} onValue={(v) => set(k, { hi: v ?? Number.NaN })} />
            <Button size="sm" variant="ghost" aria-label={`remove window ${k + 1}`} disabled={disabled}
              onClick={() => onChange(windows.filter((_, i) => i !== k))}>✕</Button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
        <Button size="sm" disabled={disabled} onClick={() => onChange([...windows, { lo: Number.NaN, hi: Number.NaN }])}>
          + Window
        </Button>
        <Button size="sm" disabled={disabled || seed.length === 0} title="Center ± FWHM of each peak in the Peaks panel."
          onClick={() => onChange(seed)}>
          From peaks ({seed.length})
        </Button>
        <Button size="sm" disabled={disabled || !roi} title="The band drawn with the plot's ROI tool."
          onClick={() => roi && onChange([...windows, { lo: Math.min(...roi), hi: Math.max(...roi) }])}>
          Add plot ROI
        </Button>
      </div>
    </div>
  );
}
