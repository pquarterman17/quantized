// P3.4 — collects the diagnostic snapshot `lib/diagnostics.ts` renders.
//
// Kept apart from the builder on purpose. Everything impure lives here
// (`navigator`, `window`, `localStorage`, the store), so the builder stays a
// pure function of an explicit snapshot and its redaction guarantee is
// testable without mounting an app. The decision about WHAT may be exposed
// belongs to `DiagnosticsSnapshot`'s shape: if a field is not on that type,
// no amount of collecting can leak it.

import { APP_VERSION, BUILD_SHA } from "../lib/buildInfo";
import { hasDesktopShell } from "../lib/desktopBridge";
import { buildDiagnostics, type DiagnosticsSnapshot } from "../lib/diagnostics";
import { isKnownStorageKey } from "../lib/storageKeys";
import { useApp } from "./useApp";

/** Byte sizes of this app's own persisted slots. Keys and sizes only — a
 *  value is measured and immediately discarded, never included.
 *
 *  Only slots on `lib/storageKeys.ts`'s allowlist are NAMED. The namespace
 *  prefix alone is not a safety property: a future `qz.figure.<user title>`
 *  would make the key itself user content, in the one section that looks too
 *  boring to audit. Anything unrecognised is still measured — quota problems
 *  are exactly what this section is for — but reported only as a count and a
 *  total.
 *
 *  Measured as UTF-8 bytes, not `String.length`. This app's stored content is
 *  full of multi-byte characters — units, Greek symbols in saved calculator
 *  inputs and plot labels — so a code-unit count understates the real size by
 *  up to 3x under a "bytes" label, in the one report whose whole value is
 *  being accurate. (Browsers vary in how they charge quota, several counting
 *  UTF-16 units; this is a well-defined figure rather than a guess at any one
 *  engine's accounting.) */
function storageSlots(): {
  known: { key: string; bytes: number }[];
  other: { slots: number; bytes: number };
} {
  const known: { key: string; bytes: number }[] = [];
  const other = { slots: 0, bytes: 0 };
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith("qz.")) continue;
      const raw = localStorage.getItem(key);
      const bytes = raw === null ? 0 : new TextEncoder().encode(raw).length;
      if (isKnownStorageKey(key)) {
        known.push({ key, bytes });
      } else {
        other.slots += 1;
        other.bytes += bytes;
      }
    }
  } catch {
    /* storage unavailable (private mode) — an empty list is the honest answer */
  }
  known.sort((a, b) => a.key.localeCompare(b.key));
  return { known, other };
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
  const slots = storageSlots();
  const rows = s.datasets.map((d) => d.data.time.length);
  const cols = s.datasets.map((d) => d.data.labels.length);

  return {
    takenAt: new Date().toISOString(),
    build: { version: APP_VERSION, sha: BUILD_SHA },
    platform: {
      userAgent: navigator.userAgent,
      language: navigator.language,
      // Via the shared bridge helper, not a hand-rolled `"pywebview" in
      // window`: pywebview creates the object and injects `.api` afterwards,
      // so the naive check reports "desktop" during a window in which no
      // native call can be made — and would miss a future Tauri shell, which
      // the same helper is designed to cover.
      desktop: hasDesktopShell(),
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
    storage: slots.known,
    otherStorage: slots.other,
  };
}

/** The text a user copies. */
export function diagnosticsText(): string {
  return buildDiagnostics(collectDiagnostics());
}
