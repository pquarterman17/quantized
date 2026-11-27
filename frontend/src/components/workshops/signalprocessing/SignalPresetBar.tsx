// Signal Processing's preset bar: the shared bar over the Signal adapter.
// Mounted by SignalProcessingPanel through a lazy seam, so none of it is eager.

import PresetBar from "../presets/PresetBar";
import { createSignalAdapter, type SignalPanelHandle } from "./presetAdapter";

export default function SignalPresetBar({ panel, fromResult, running }: { panel: SignalPanelHandle; fromResult: boolean; running: boolean }) {
  return <PresetBar adapter={createSignalAdapter(panel)} fromResult={fromResult} running={running} />;
}
