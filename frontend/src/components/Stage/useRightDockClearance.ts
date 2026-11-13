// The right padding a stage cell needs so its plot reflows to the left of a
// docked tool window (store/rightDock.ts). Measures the cell's own right edge
// (its box does not move when its padding changes, so this cannot feed back).

import { useEffect, useState, type RefObject } from "react";

import { rightDockClearance, useRightDockLeft } from "../../store/rightDock";

export function useRightDockClearance(cell: RefObject<HTMLElement | null>): number {
  const dockLeft = useRightDockLeft();
  const [right, setRight] = useState<number | null>(null);
  useEffect(() => {
    const el = cell.current;
    if (!el || dockLeft === null) return;
    const measure = () => setRight(el.getBoundingClientRect().right);
    measure();
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [cell, dockLeft]);
  return right === null ? 0 : rightDockClearance(right, dockLeft);
}
