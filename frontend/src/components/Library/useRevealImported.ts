// Keep a finished import visible while the Library is focused or type-filtered.
//
// Focus (`useLibraryFocus`) and the content filter are session-only browse
// scopes, so an import that lands outside them used to be invisible: the new
// dataset existed but no row showed it. When a batch finishes, the dataset it
// made active (else its last one) is handed to the Library's existing "Show
// in Library" reveal, which clears the focus, resets a hiding type filter,
// expands ancestors and scrolls the row into view. A dataset the current
// scope already shows is left alone, so an ordinary import is unchanged.

import { useEffect, useRef, useState } from "react";

import type { LibraryHierarchy } from "../../lib/libraryHierarchy";
import { useImportBatch } from "../../store/importBatch";
import { useApp } from "../../store/useApp";

export function useRevealImported(
  shown: LibraryHierarchy,
  requestReveal: (target: string) => void,
): void {
  const added = useRef<string[] | null>(null);
  const [finished, setFinished] = useState(0);

  // Snapshot the dataset ids when a batch starts, synchronously with the flag,
  // so the diff at the end is exactly what the batch added.
  useEffect(() => {
    let before: Set<string> | null = null;
    return useImportBatch.subscribe((state, prev) => {
      if (state.running && !prev.running) {
        before = new Set(useApp.getState().datasets.map((d) => d.id));
      } else if (!state.running && prev.running && before) {
        const seen = before;
        before = null;
        const ids = useApp.getState().datasets.filter((d) => !seen.has(d.id)).map((d) => d.id);
        if (ids.length) {
          added.current = ids;
          setFinished((n) => n + 1);
        }
      }
    });
  }, []);

  // Decide against the hierarchy of the render that shows the new datasets.
  useEffect(() => {
    const ids = added.current;
    if (!ids) return;
    added.current = null;
    const activeId = useApp.getState().activeId;
    const target = activeId && ids.includes(activeId) ? activeId : ids[ids.length - 1];
    if (!shown.byKey.has(`worksheet:${target}`)) requestReveal(target);
  }, [finished, shown, requestReveal]);
}
