// The shared Apply / OK / Cancel behaviour of the figure popups (plan item 44,
// Origin's Plot Details). A popup calls `useApplySession(label)` and wraps each
// Apply's store writes in the function it returns; the hook gives it:
//   - one undo step for the whole popup session (store/popupSession.ts);
//   - "nothing to discard" for the host's outside-click question (E6): after an
//     Apply the popup counts as unedited until the next edit.
// Cancel, Esc and the backdrop only close; they keep whatever was applied.

import { createContext, useCallback, useContext, useRef } from "react";

import { createPopupSession, type PopupSession } from "../store/popupSession";
import { useApp } from "../store/useApp";

/** Provided by the host (FigureDialogs): called after an Apply, so the outside-click question only covers later edits. */
export const AppliedContext = createContext<() => void>(() => undefined);

export function useApplySession(fallbackLabel: string): <T>(fn: () => T) => T {
  const afterApply = useContext(AppliedContext);
  const session = useRef<PopupSession | null>(null);
  session.current ??= createPopupSession(() => useApp.getState(), fallbackLabel);
  return useCallback(
    <T,>(fn: () => T): T => {
      const result = session.current!.run(fn);
      afterApply();
      return result;
    },
    [afterApply],
  );
}
