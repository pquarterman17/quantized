// The Data window's switcher pick (WORKSPACE_LAYOUT_PLAN D14): which input of
// a multi-dataset plot it shows. Session-only view state shared by the title
// bar (the name) and the body (the switcher); never saved. The pick belongs
// to the plot dataset it was made on, so focusing another graph starts from
// that graph's own sheet; a pick that is no longer one of the plot's inputs
// is ignored by lib/windowLayout/dataSource.ts (the first input shows).

import { useSyncExternalStore } from "react";

export interface DataChoice {
  /** The plot's dataset the pick was made on. */
  plot: string;
  /** The input picked. */
  id: string;
}

let chosen: DataChoice | null = null;
const listeners = new Set<() => void>();

export function setDataChoice(next: DataChoice | null): void {
  if (next?.plot === chosen?.plot && next?.id === chosen?.id) return;
  chosen = next;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
const read = () => chosen;

/** The pick made on `plot`, or null. */
export function useDataChoice(plot: string | null): string | null {
  const c = useSyncExternalStore(subscribe, read, read);
  return c && c.plot === plot ? c.id : null;
}
