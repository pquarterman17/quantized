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
import { useAutosaveStatus } from "./autosaveStatus";
import { getBackendHealth, type BackendInfo } from "./backendHealth";
import { usePendingOps } from "./pendingOps";
import { useRecoveryChoice } from "./recoveryChoice";
import { notificationCounts } from "./toasts";
import { useApp } from "./useApp";

/** Whole seconds since `at`, or null when there is no such moment. Clamped at
 *  zero so a clock that stepped backwards reads as "just now" rather than
 *  printing a negative age. */
function ageSec(at: number | null, now: number): number | null {
  return at === null ? null : Math.max(0, Math.round((now - at) / 1000));
}

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

export function collectDiagnostics(backend: BackendInfo = getBackendHealth()): DiagnosticsSnapshot {
  const s = useApp.getState();
  const slots = storageSlots();
  const rows = s.datasets.map((d) => d.data.time.length);
  const cols = s.datasets.map((d) => d.data.labels.length);
  const now = Date.now();
  const health = useAutosaveStatus.getState().health;
  const notifications = notificationCounts();

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
    backend,
    session: {
      lastAutosaveAgeSec: ageSec(health.savedAt, now),
      // `error` is the failure REASON; only whether it is set crosses into the
      // bundle. See lib/diagnostics.ts's header for that decision.
      autosaveFailing: health.error !== null,
      autosaveGenerations: health.count,
      recoveryPromptOpen: useRecoveryChoice.getState().pending !== null,
      pendingOps: usePendingOps.getState().ops.length,
      notifications: {
        total: notifications.totalCount,
        errors: notifications.errorCount,
        lastErrorAgeSec: ageSec(notifications.lastErrorAt, now),
      },
    },
  };
}

/** The text a user copies.
 *
 *  Synchronous end to end (P3.4 review round, 2026-09-14): this used to
 *  `await probeBackend()` — a fresh `/api/health` fetch, up to 1.5 s, on
 *  every call — which put a network round-trip directly between the user's
 *  click and the clipboard write. See `store/backendHealth.ts`'s header for
 *  why that is a real hazard in this app (the same one `lib/clipboard.ts`
 *  already documents for the PNG-copy path) and why the fix is reading the
 *  app's own startup handshake back instead of re-probing. */
export function diagnosticsText(): string {
  return buildDiagnostics(collectDiagnostics());
}
