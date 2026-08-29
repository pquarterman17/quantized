// P3.4 — collects the diagnostic snapshot `lib/diagnostics.ts` renders.
//
// Kept apart from the builder on purpose. Everything impure lives here
// (`navigator`, `window`, `localStorage`, the store), so the builder stays a
// pure function of an explicit snapshot and its redaction guarantee is
// testable without mounting an app. The decision about WHAT may be exposed
// belongs to `DiagnosticsSnapshot`'s shape: if a field is not on that type,
// no amount of collecting can leak it.

import { buildDiagnostics, type DiagnosticsSnapshot } from "../lib/diagnostics";
import { useApp } from "./useApp";

/** Byte sizes of this app's own persisted slots. Keys and lengths only —
 *  values are never read, let alone included. */
function storageSlots(): { key: string; bytes: number }[] {
  const out: { key: string; bytes: number }[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith("qz.")) continue;
      out.push({ key, bytes: localStorage.getItem(key)?.length ?? 0 });
    }
  } catch {
    /* storage unavailable (private mode) — an empty list is the honest answer */
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/** True when the OS asks for reduced motion, independent of the app's own
 *  preference — the two are separately settable and a motion report is
 *  ambiguous without both. */
function osReduceMotion(): boolean {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    return false;
  }
}

export function collectDiagnostics(): DiagnosticsSnapshot {
  const s = useApp.getState();
  const rows = s.datasets.map((d) => d.data.time.length);
  const cols = s.datasets.map((d) => d.data.labels.length);

  return {
    takenAt: new Date().toISOString(),
    platform: {
      userAgent: navigator.userAgent,
      language: navigator.language,
      desktop: typeof window !== "undefined" && "pywebview" in window,
    },
    display: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
    environment: {
      theme: s.theme,
      density: s.density,
      accent: s.accent,
      reduceMotionPref: s.reduceMotion,
      reduceMotionOS: osReduceMotion(),
    },
    workspace: {
      datasets: s.datasets.length,
      workbooks: s.workbooks.length,
      folders: s.folders.length,
      figures: s.editableFigures?.length ?? 0,
      openWindows: s.plotWindows?.length ?? 0,
      largestDatasetRows: rows.length ? Math.max(...rows) : 0,
      largestDatasetColumns: cols.length ? Math.max(...cols) : 0,
      datasetsWithFormulas: s.datasets.filter((d) => d.formulas?.length).length,
      datasetsWithCorrections: s.datasets.filter((d) => d.corrections).length,
      datasetsWithErrorRoles: s.datasets.filter((d) => d.errorRoles?.length).length,
      stageTab: s.stageTab,
    },
    storage: storageSlots(),
  };
}

/** The text a user copies. */
export function diagnosticsText(): string {
  return buildDiagnostics(collectDiagnostics());
}
