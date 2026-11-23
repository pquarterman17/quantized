// The name of a dataset a title bar showed, kept for as long as the title bar is mounted, so a pin to
// a dataset that is then removed still says which ("two-peaks.csv was removed", not "removed dataset";
// UX pass 3 m-7). Per mount on purpose: nothing outlives the window or leaks into another project.

import { useEffect, useRef } from "react";

/** `name` while the dataset `id` exists; once it is gone, the last name seen for it (else undefined). */
export function useSeenName(id: string | null, name: string | undefined): string | undefined {
  const seen = useRef(new Map<string, string>());
  useEffect(() => {
    if (id !== null && name) seen.current.set(id, name);
  }, [id, name]);
  return name ?? (id === null ? undefined : seen.current.get(id));
}
