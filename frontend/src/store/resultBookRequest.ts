// "Open saved result" from a statistics tool (lane RB3): open the saved
// Library result on its Result book tab. A standalone store (the
// store/variability.ts precedent: useApp sits at its size pin). The request
// names the result id, so a request for one result never switches the tab of
// another; the result workspace consumes it once. A request whose result is no
// longer the open one (closed, switched, or reset by Undo before the workspace
// mounted) is dropped, so a LATER open never jumps to the book.

import { create } from "zustand";

import { useApp } from "./useApp";

interface ResultBookRequestState {
  /** The result whose workspace should show the Result book tab, once. */
  bookFor: string | null;
  consume: () => void;
}

export const useResultBookRequest = create<ResultBookRequestState>((set) => ({
  bookFor: null,
  consume: () => set({ bookFor: null }),
}));

useApp.subscribe((state) => {
  const { bookFor } = useResultBookRequest.getState();
  if (bookFor !== null && state.openAnalysisResultId !== bookFor) useResultBookRequest.setState({ bookFor: null });
});

/** Opens a saved result on its Result book tab. Refuses (false) when the
 *  result is gone (deleted or undone since the tool looked it up). */
export function openResultBook(id: string): boolean {
  const state = useApp.getState();
  if (!state.analysisResults.some((result) => result.id === id)) {
    state.setStatus("can't open the saved result: it was deleted", "danger");
    return false;
  }
  // Open first: the request must name the result that is open by then.
  useApp.setState({ openAnalysisResultId: id });
  useResultBookRequest.setState({ bookFor: id });
  return true;
}
