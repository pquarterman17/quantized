// The datasets the Data window has shown this session: the Analysis guide's
// "Inspect" step is done once the data has been looked at (WORKSPACE_LAYOUT_PLAN
// P4). Session-only view state, never saved: reopening a project starts every
// dataset at "not started" for this step, which overstates nothing.

import { useSyncExternalStore } from "react";

let seen: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

export function markInspected(id: string): void {
  if (seen.has(id)) return;
  seen = new Set(seen).add(id);
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
const read = () => seen;

export function useInspected(id: string): boolean {
  return useSyncExternalStore(subscribe, read, read).has(id);
}

/** Tests only. */
export function resetInspectedForTests(): void {
  seen = new Set();
  for (const l of listeners) l();
}
