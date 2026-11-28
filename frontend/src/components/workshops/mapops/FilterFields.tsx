// Map operations — the option fields of the 2-D FFT, 2-D FFT filter and image
// filter operations (split out of MapOpsPanel to keep it small).

import { Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import { NumberField } from "../../primitives/NumberField";
import type { MapOpsForm } from "./mapOpsForm";
import { EDGE_MODE_OPTIONS, FFT_OUTPUT_OPTIONS, FFT_WINDOW_OPTIONS, FILTER_MODE_OPTIONS, IMAGE_FILTER_OPTIONS, SOBEL_OPTIONS } from "./mapOpsOptions";

const gap = { marginTop: 8 } as const;
const faint = { color: "var(--text-faint)" } as const;

interface Props {
  f: MapOpsForm;
  set: (patch: Partial<MapOpsForm>) => void;
}

export function FftFields({ f, set }: Props) {
  return (
    <>
      <Select aria-label="FFT output" options={[...FFT_OUTPUT_OPTIONS]} value={f.fftOutput} onChange={(e) => set({ fftOutput: e.target.value as MapOpsForm["fftOutput"] })} />
      <label className="qzk-field-lbl" style={gap}>Window</label>
      <Select aria-label="FFT window" options={[...FFT_WINDOW_OPTIONS]} value={f.fftWindow} onChange={(e) => set({ fftWindow: e.target.value as MapOpsForm["fftWindow"] })} />
      <div style={gap}>
        <Checkbox checked={f.fftRemoveMean} onChange={(v) => set({ fftRemoveMean: v })}>Subtract the mean first</Checkbox>
      </div>
      <div className="qzk-helptext" style={{ ...gap, ...faint }}>
        Centered spectrum on frequency axes in cycles per axis unit (1/nm for nm). Needs evenly spaced axes and no blank cells. Phase is measured from the first cell.
      </div>
    </>
  );
}

export function FftFilterFields({ f, set }: Props) {
  const lo = f.fMode !== "lowpass", hi = f.fMode !== "highpass";
  return (
    <>
      <Select aria-label="Filter type" options={[...FILTER_MODE_OPTIONS]} value={f.fMode} onChange={(e) => set({ fMode: e.target.value as MapOpsForm["fMode"] })} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, ...gap }}>
        {lo && <NumberField aria-label="Low cutoff" placeholder="Low cutoff" value={f.cutLow} onChange={(v) => set({ cutLow: v })} />}
        {hi && <NumberField aria-label="High cutoff" placeholder="High cutoff" value={f.cutHigh} onChange={(v) => set({ cutHigh: v })} />}
        <NumberField aria-label="Edge softness" placeholder="Edge softness" value={f.edgeSigma} onChange={(v) => set({ edgeSigma: v })} />
      </div>
      <div className="qzk-helptext" style={{ ...gap, ...faint }}>
        Radial cutoffs in reciprocal axis units (the 2-D FFT axes). Edge softness is a Gaussian transition width in the same units; 0 is a hard edge. The map is treated as periodic, so edges can ring. X and Y units must match.
      </div>
    </>
  );
}

export function ImageFilterFields({ f, set }: Props) {
  const k = f.imgKind;
  return (
    <>
      <Select aria-label="Filter" options={[...IMAGE_FILTER_OPTIONS]} value={k} onChange={(e) => set({ imgKind: e.target.value as MapOpsForm["imgKind"] })} />
      <div style={gap}>
        {k === "gaussian" && <NumberField aria-label="Sigma (pixels)" placeholder="Sigma (pixels)" value={f.sigma} onChange={(v) => set({ sigma: v })} />}
        {(k === "median" || k === "uniform") && <NumberField aria-label="Window size (pixels)" placeholder="Window size (pixels)" value={f.size} onChange={(v) => set({ size: v })} />}
        {k === "sobel" && <Select aria-label="Sobel output" options={[...SOBEL_OPTIONS]} value={f.gradient} onChange={(e) => set({ gradient: e.target.value as MapOpsForm["gradient"] })} />}
      </div>
      <label className="qzk-field-lbl" style={gap}>Edge handling</label>
      <Select aria-label="Edge mode" options={[...EDGE_MODE_OPTIONS]} value={f.edgeMode} onChange={(e) => set({ edgeMode: e.target.value as MapOpsForm["edgeMode"] })} />
      {f.edgeMode === "constant" && <div style={gap}><NumberField aria-label="Edge value" placeholder="Edge value" value={f.cval} onChange={(v) => set({ cval: v })} /></div>}
      <div className="qzk-helptext" style={{ ...gap, ...faint }}>
        Sizes are in pixels (scipy.ndimage). Blank cells are refused. Sobel / Laplacian results are per pixel, unnormalized.
      </div>
    </>
  );
}
