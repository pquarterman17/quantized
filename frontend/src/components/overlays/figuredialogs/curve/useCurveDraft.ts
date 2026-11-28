// State for the Plot details popup: the draft of `curveDraft.ts` plus the
// setters the tabs share. `setSeriesStyle` has the store setter's signature,
// so a sub-control takes it exactly as it takes the live one.

import { useCallback, useState } from "react";

import { effectiveYError } from "../../../../lib/errorRoles";
import { useApp } from "../../../../store/useApp";
import type { CurveDraft, DraftSetStyle } from "../../../../store/commitCurveDraft";

export function useCurveDraft(channel: number, datasetId: string | null) {
  // Read through hooks, used only by the first render's initialisers: the draft
  // starts as a copy of what the store holds when the popup opens.
  const stored = useApp((st) => st.seriesStyles);
  const errKeys = useApp((st) => st.errKeys);
  const roles = useApp((st) => st.datasets.find((d) => d.id === datasetId)?.errorRoles);
  const [initialErr, setInitialErr] = useState<number | null>(() => effectiveYError(errKeys, roles, channel) ?? null);
  const [draft, setDraft] = useState<CurveDraft>(() => ({ styles: { ...stored }, errCol: initialErr }));
  const setSeriesStyle: DraftSetStyle = useCallback(
    (ch, patch) => setDraft((d) => ({ ...d, styles: { ...d.styles, [ch]: { ...d.styles[ch], ...patch } } })),
    [],
  );
  const setErrCol = useCallback((errCol: number | null) => setDraft((d) => ({ ...d, errCol })), []);
  const reset = useCallback(() => setDraft((d) => ({ ...d, styles: { ...d.styles, [channel]: {} } })), [channel]);
  /** An Apply wrote the draft: its error column is now the live one. */
  const applied = useCallback((errCol: number | null) => setInitialErr(errCol), []);
  return { draft, initialErr, setSeriesStyle, setErrCol, reset, applied };
}
