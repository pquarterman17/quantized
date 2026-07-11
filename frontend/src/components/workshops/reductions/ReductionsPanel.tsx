// Reductions workshop — view. A draggable ToolWindow with a method picker
// (Williamson-Hall / FFT film thickness / Reflectivity FFT); each method is a
// self-contained section (its own hook + inputs + results). The Analyze-menu
// commands ("Williamson-Hall…", "Film thickness (FFT)…", "Reflectivity
// FFT…") open this SAME window pre-set to their method via the store's
// `reductionsMethod` (see store/reductions.ts, appCommands.ts's
// `openReductions`). Thin — logic lives in the per-method hooks.

import ToolWindow from "../../overlays/ToolWindow";
import { Select } from "../../primitives";
import type { ReductionsMethod } from "../../../store/reductions";
import { useApp } from "../../../store/useApp";
import FftThicknessSection from "./FftThicknessSection";
import ReflectivityFftSection from "./ReflectivityFftSection";
import WilliamsonHallSection from "./WilliamsonHallSection";

const METHODS: { value: ReductionsMethod; label: string }[] = [
  { value: "williamson-hall", label: "Williamson-Hall (size + strain)" },
  { value: "fft-thickness", label: "Film thickness (XRD FFT)" },
  { value: "reflectivity-fft", label: "Reflectivity FFT (Kiessig / superlattice)" },
];

export default function ReductionsPanel() {
  const setOpen = useApp((s) => s.setReductionsOpen);
  const method = useApp((s) => s.reductionsMethod);
  const setMethod = useApp((s) => s.setReductionsMethod);

  return (
    <ToolWindow title="Reductions" width={380} onClose={() => setOpen(false)}>
      <label className="qzk-field-lbl">Method</label>
      <Select
        options={METHODS}
        value={method}
        onChange={(e) => setMethod(e.target.value as ReductionsMethod)}
      />
      {method === "williamson-hall" && <WilliamsonHallSection />}
      {method === "fft-thickness" && <FftThicknessSection />}
      {method === "reflectivity-fft" && <ReflectivityFftSection />}
    </ToolWindow>
  );
}
