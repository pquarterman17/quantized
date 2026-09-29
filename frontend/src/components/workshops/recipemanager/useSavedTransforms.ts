// The saved transformation recipes, kept live for the Recipe Manager's
// Transform pickers. The list lives in localStorage (`lib/template.ts`), which
// the Pipeline workshop and a `.dwk` open write while the manager may be open,
// so a once-per-mount read went stale. Re-read on this window's own writes
// (`TEMPLATES_CHANGED_EVENT`) and on another window's (`storage`).

import { useEffect, useState } from "react";

import { loadTemplates, TEMPLATES_CHANGED_EVENT, type AnalysisTemplate } from "../../../lib/template";
import { TEMPLATES_KEY } from "../../../lib/templateKey";

export function useSavedTransforms(): AnalysisTemplate[] {
  const [transforms, setTransforms] = useState(loadTemplates);
  useEffect(() => {
    const reload = (): void => setTransforms(loadTemplates());
    const onStorage = (e: StorageEvent): void => {
      if (e.key === null || e.key === TEMPLATES_KEY) reload();
    };
    window.addEventListener(TEMPLATES_CHANGED_EVENT, reload);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(TEMPLATES_CHANGED_EVENT, reload);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return transforms;
}
