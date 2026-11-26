// The FFT gadget's output choice, lazy (rendered by PlotResultChips only while
// the gadget is in FFT mode): magnitude (the default), PSD per frequency unit,
// or PSD power per bin. Changing it re-arms the same region, which drops the
// spectrum shown and recomputes it, so a stale preview is never committed under
// the new label.

import type { GadgetFftOutput } from "../../lib/gadgetFftColumn";
import { useGadgetFftOptions } from "../../store/gadgetFftOptions";
import { useApp } from "../../store/useApp";
import { Select } from "../primitives";

const OPTIONS = [
  { value: "magnitude", label: "Magnitude" },
  { value: "psd", label: "PSD (density)" },
  { value: "power", label: "PSD (power per bin)" },
];

export default function GadgetFftOptions() {
  const output = useGadgetFftOptions((s) => s.output);
  const setOutput = useGadgetFftOptions((s) => s.setOutput);
  const roi = useApp((s) => s.qfitRoi);
  const setQfitRoi = useApp((s) => s.setQfitRoi);
  return (
    <Select
      aria-label="FFT output"
      options={OPTIONS}
      value={output}
      onChange={(e) => {
        setOutput(e.target.value as GadgetFftOutput);
        if (roi) setQfitRoi(roi);
      }}
    />
  );
}
