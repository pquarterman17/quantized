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
import type { Dataset } from "../../lib/types";
import { useImportBatch } from "../../store/importBatch";

export function useRevealImported(
  datasets: Dataset[],
  activeId: string | null,
  shown: LibraryHierarchy,
  requestReveal: (target: string) => void,
): void {
  const rendered = useRef(datasets);
  const before = useRef<Set<string> | null>(null);
  const [finished, setFinished] = useState(0);

  useEffect(() => {
    rendered.current = datasets;
  }, [datasets]);

  // Snapshot the ids synchronously with the batch flag (the datasets last
  // rendered are the pre-import ones), and mark the end of the batch.
  useEffect(
    () =>
      useImportBatch.subscribe((state, prev) => {
        if (state.running && !prev.running) before.current = new Set(rendered.current.map((d) => d.id));
        else if (!state.running && prev.running && before.current) setFinished((n) => n + 1);
      }),
    [],
  );

  // Decide on the render that already shows the batch's datasets.
  useEffect(() => {
    const seen = before.current;
    if (!seen || finished === 0) return;
    before.current = null;
    const ids = datasets.filter((d) => !seen.has(d.id)).map((d) => d.id);
    if (ids.length === 0) return;
    const target = activeId && ids.includes(activeId) ? activeId : ids[ids.length - 1];
    if (!shown.byKey.has(`worksheet:${target}`)) requestReveal(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per finished batch
  }, [finished]);
}
