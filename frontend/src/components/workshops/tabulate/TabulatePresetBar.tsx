// Tabulate's preset bar: the shared bar over the Tabulate adapter. Mounted by
// TabulatePanel through a lazy seam, so none of it is eager.

import PresetBar from "../presets/PresetBar";
import { createTabulateAdapter } from "./presetAdapter";
import type { TabulateState } from "./useTabulate";

export default function TabulatePresetBar({ t }: { t: Pick<TabulateState, "columns" | "groupCols" | "valueCols" | "statKeys" | "grandTotal" | "applyLayout" | "fromResult" | "reportBusy"> }) {
  const adapter = createTabulateAdapter({
    columns: () => t.columns,
    getLayout: () => ({ groupCols: t.groupCols, valueCols: t.valueCols, statKeys: t.statKeys, grandTotal: t.grandTotal }),
    setLayout: t.applyLayout,
  });
  return <PresetBar adapter={adapter} fromResult={t.fromResult} running={t.reportBusy} />;
}
