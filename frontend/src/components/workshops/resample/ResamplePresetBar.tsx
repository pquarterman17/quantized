// Resample's preset bar: the shared bar over the Resample adapter. Mounted by
// ResamplePanel through a lazy seam, so none of it is eager.

import PresetBar from "../presets/PresetBar";
import { createResampleAdapter } from "./presetAdapter";
import type { ResampleState } from "./useResample";

export default function ResamplePresetBar({ r }: { r: ResampleState }) {
  const adapter = createResampleAdapter({ getForm: () => r.form, replaceForm: r.replaceForm });
  return <PresetBar adapter={adapter} fromResult={r.fromResult} running={r.busy} />;
}
