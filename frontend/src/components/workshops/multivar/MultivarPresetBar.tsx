// Multivariate's preset bar: the shared bar over the Multivariate adapter.
// Mounted by MultivarPanel through a lazy seam, so none of it is eager. The
// analyses run on their own as the settings change, so there is no run that
// ends a draft: `running` stays false and Revert lasts until the panel closes.

import PresetBar from "../presets/PresetBar";
import { createMultivarAdapter } from "./presetAdapter";
import type { MultivarState } from "./useMultivar";

export default function MultivarPresetBar({ m, fromResult }: { m: Pick<MultivarState, "columns" | "selected" | "setSelected" | "method" | "setMethod" | "standardize" | "setStandardize" | "pcX" | "pcY" | "setPcX" | "setPcY">; fromResult: boolean }) {
  const adapter = createMultivarAdapter({
    columns: () => m.columns,
    getSelected: () => m.selected, setSelected: m.setSelected,
    getMethod: () => m.method, setMethod: m.setMethod,
    getStandardize: () => m.standardize, setStandardize: m.setStandardize,
    getPc: () => ({ pcX: m.pcX, pcY: m.pcY }),
    setPc: (x, y) => { m.setPcX(x); m.setPcY(y); },
  });
  return <PresetBar adapter={adapter} fromResult={fromResult} running={false} />;
}
