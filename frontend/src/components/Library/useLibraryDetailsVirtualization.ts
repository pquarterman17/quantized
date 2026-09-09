// LibraryDetails.tsx's own virtualization wiring (E-c3), split out to keep
// that component under the .tsx ceiling: the scroll ref, the windowed row
// slice, the "keep the selected row visible" effect (Show in Library must
// still work — see useListVirtualization's header), the fallback tab stop
// when the model-level one scrolls out of the rendered window, and the
// virtualization-aware version of focusRowAt. LibraryDetails owns only the
// markup and its OWN keyboard/sort/selection concerns; this owns the
// windowing.

import { useEffect, useRef, type RefObject } from "react";

import { focusRowWhenRendered, useListVirtualization, type ListWindow } from "./useListVirtualization";
import type { LibraryDetailsRow } from "../../lib/libraryDetails";

export interface DetailsVirtualization {
  scrollRef: RefObject<HTMLDivElement | null>;
  virt: ListWindow;
  rendered: LibraryDetailsRow[];
  /** The model-level roving key, clamped to a row that's actually rendered —
   *  same contract as LibraryWorkspace's `effectiveTabStop`: the table must
   *  always carry exactly one tabbable row, or Tab can no longer reach it. */
  effectiveRovingKey: string | null;
  /** `fromKey` is the row the keystroke originated on (still focused while
   *  `index`'s row may not be mounted yet) — passed through to
   *  focusRowWhenRendered's "owned" list so its retry doesn't abort on its
   *  very first check (the mid-transition focus legitimately still sits on
   *  the FROM row until the target actually mounts). Omit only when there is
   *  no such row (e.g. the removal-recovery effect, whose old row is gone). */
  focusRowAt: (index: number, fromKey?: string) => void;
}

export function useLibraryDetailsVirtualization(
  rows: LibraryDetailsRow[],
  panelRef: RefObject<HTMLElement | null> | undefined,
  rovingKey: string | null,
  selectedRow: LibraryDetailsRow | undefined,
): DetailsVirtualization {
  const scrollRef = useRef<HTMLDivElement>(null);
  // The table sits directly inside this div, so it doubles as the row
  // container the hook measures.
  const virt = useListVirtualization(rows.length, panelRef, scrollRef, "[data-lib-row]");
  const rendered = virt.virtualized ? rows.slice(virt.start, virt.end) : rows;
  const effectiveRovingKey = rendered.some((r) => r.node.key === rovingKey) ? rovingKey : rendered[0]?.node.key ?? null;

  // "Show in Library" (and any ordinary selection change) keeps the
  // now-selected row inside the rendered window — selectLibraryNode runs
  // BEFORE Library.tsx's reveal-effect scrollIntoView retry, so without this
  // the retry's target row never mounts under virtualization.
  // REVIEW ROUND — the same defect as LibraryTree's twin of this effect: keyed
  // on the selectedRow OBJECT, which is reallocated on every `rows` rebuild, so
  // it re-fired on each filter keystroke, sort change and dataset mutation and
  // dragged the panel back to the selection while the user was scrolled
  // somewhere else. Keyed on the stable row KEY now, so it fires when the
  // SELECTION changes.
  const selectedKey = selectedRow?.node.key ?? null;
  useEffect(() => {
    if (!virt.virtualized || selectedKey == null) return;
    const idx = rows.findIndex((r) => r.node.key === selectedKey);
    if (idx >= 0) virt.ensureVisible(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the STABLE selection key; `rows`/`ensureVisible` are read, not tracked
  }, [selectedKey, virt.virtualized]);

  const focusRowAt = (index: number, fromKey?: string): void => {
    const key = rows[index]?.node.key;
    if (key == null) return;
    const selector = `[data-lib-row="${CSS.escape(key)}"]`;
    if (!virt.virtualized) {
      (scrollRef.current?.querySelector(selector) as HTMLElement | null)?.focus();
      return;
    }
    virt.ensureVisible(index);
    focusRowWhenRendered(
      selector,
      fromKey != null ? [`[data-lib-row="${CSS.escape(fromKey)}"]`] : [],
      scrollRef.current,
    );
  };

  return { scrollRef, virt, rendered, effectiveRovingKey, focusRowAt };
}
