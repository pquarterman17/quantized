// Map operations: the options of the 2-D wavelet denoise / smooth (PyWavelets,
// an optional extra; without it the backend refuses with the install instruction).

import { Select } from "../../primitives";
import { NumberField } from "../../primitives/NumberField";
import type { MapOpsForm } from "./mapOpsForm";
import { WAVELET_ACTION_OPTIONS, WAVELET_MODE_OPTIONS, WAVELET_OPTIONS, WAVELET_THRESHOLD_OPTIONS } from "./mapOpsOptions";

const gap = { marginTop: 8 } as const;
const faint = { color: "var(--text-faint)" } as const;

interface Props {
  f: MapOpsForm;
  set: (patch: Partial<MapOpsForm>) => void;
}

export function WaveletFields({ f, set }: Props) {
  return (
    <>
      <Select aria-label="Wavelet action" options={[...WAVELET_ACTION_OPTIONS]} value={f.wtAction} onChange={(e) => set({ wtAction: e.target.value as MapOpsForm["wtAction"] })} />
      <label className="qzk-field-lbl" style={gap}>Wavelet</label>
      <Select aria-label="Wavelet" options={WAVELET_OPTIONS} value={f.wtWavelet} onChange={(e) => set({ wtWavelet: e.target.value })} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, ...gap }}>
        <NumberField aria-label="Wavelet levels" placeholder="Levels (auto)" value={f.wtLevel} onChange={(v) => set({ wtLevel: v })} />
        <Select aria-label="Wavelet edge extension" options={WAVELET_MODE_OPTIONS} value={f.wtMode} onChange={(e) => set({ wtMode: e.target.value })} />
      </div>
      {f.wtAction === "denoise" ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, ...gap }}>
          <Select aria-label="Thresholding" options={[...WAVELET_THRESHOLD_OPTIONS]} value={f.wtThreshold} onChange={(e) => set({ wtThreshold: e.target.value as MapOpsForm["wtThreshold"] })} />
          <NumberField aria-label="Threshold value" placeholder="Threshold (auto)" value={f.wtValue} onChange={(v) => set({ wtValue: v })} />
        </div>
      ) : (
        <div style={gap}>
          <NumberField aria-label="Detail levels to zero" placeholder="Levels to zero, e.g. 1,2" value={f.wtZero} onChange={(v) => set({ wtZero: v })} />
        </div>
      )}
      <div className="qzk-helptext" style={{ ...gap, ...faint }}>
        Denoise shrinks every detail band (horizontal, vertical, diagonal) of every level, never the approximation. Automatic threshold: sigma x sqrt(2 ln N), with sigma = median |finest diagonal band| / 0.6745 and N the number of cells; a typed threshold is in the map&apos;s value unit, and 0 changes nothing. Smooth zeroes the chosen detail levels (1 is the finest). Needs PyWavelets (pip install quantized-lab[wavelets]) and no blank cells.
      </div>
    </>
  );
}
