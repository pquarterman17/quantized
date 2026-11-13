// How far down the Stat Stage's floating tool bar reaches, so the plot can sit
// below it (figures live check). The bar is a wrapping row of pickers floated
// over the stage: one row at a wide window, four or five in a small graph
// window, where it hid the whole chart -- and at any width it covered the top
// of the tallest bar or whisker (lane 3's "Stat Stage dock covers tall
// whisker"). A ResizeObserver tracks the bar's bottom edge as it wraps; the
// bar itself is capped at 40% of the stage and scrolls past that
// (StatStage.tsx), so a small window keeps most of its height for the plot.

import { useCallback, useState } from "react";

/** A callback ref for the floating bar, and the px from the stage's top to
 *  just below it (0 until measured). */
export function useToolsClearance(): [(el: HTMLElement | null) => void, number] {
  const [clearance, setClearance] = useState(0);
  const ref = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const measure = () => setClearance(Math.ceil(el.offsetTop + el.offsetHeight + 4));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // A callback ref has no cleanup; the observer goes with the element.
    (el as HTMLElement & { __qzToolsRo?: ResizeObserver }).__qzToolsRo?.disconnect();
    (el as HTMLElement & { __qzToolsRo?: ResizeObserver }).__qzToolsRo = ro;
  }, []);
  return [ref, clearance];
}
