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
import { usePendingOps } from "./pendingOps";
import { useRecoveryChoice } from "./recoveryChoice";
import { recentNotificationMarks } from "./toasts";
import { useApp } from "./useApp";

type BackendInfo = DiagnosticsSnapshot["backend"];

/** What a backend that did not answer looks like. Also the value used when no
 *  probe was made at all — the report says "unreachable" either way, which is
 *  the honest reading for a consumer: this SPA could not name a server. */
const BACKEND_UNREACHABLE: BackendInfo = { reachable: false, app: null, version: null };

/** Give up after this long. The user is waiting on a clipboard write; a
 *  hung backend must not hold the whole bundle hostage. */
const BACKEND_PROBE_MS = 1500;

/** Ask the server who it is. `/api/health` (src/quantized/app.py) already
 *  serves `{status, app, version}` for the launcher's identity handshake, so
 *  no new route is needed — this is the same fetch, read for its version.
 *  Fetched directly rather than through `lib/api.ts`'s `health()` because
 *  that wrapper's return type discards everything but `status`. */
export async function probeBackend(): Promise<BackendInfo> {
  try {
    const res = await Promise.race([
      fetch("/api/health"),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), BACKEND_PROBE_MS)),
    ]);
    if (!res?.ok) return BACKEND_UNREACHABLE;
    const body = (await res.json()) as { app?: string; version?: string };
    return { reachable: true, app: body.app ?? null, version: body.version ?? null };
  } catch {
    // Offline, blocked, a file:// page, or no fetch at all — all of which are
    // "could not name a server", and none of which should fail the bundle.
    return BACKEND_UNREACHABLE;
  }
}

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

export function collectDiagnostics(backend: BackendInfo = BACKEND_UNREACHABLE): DiagnosticsSnapshot {
  const s = useApp.getState();
  const slots = storageSlots();
  const rows = s.datasets.map((d) => d.data.time.length);
  const cols = s.datasets.map((d) => d.data.labels.length);
  const now = Date.now();
  const health = useAutosaveStatus.getState().health;
  const marks = recentNotificationMarks();
  const errors = marks.filter((m) => m.kind === "danger");

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
        total: marks.length,
        errors: errors.length,
        lastErrorAgeSec: ageSec(errors.length ? errors[errors.length - 1].at : null, now),
      },
    },
  };
}

/** The text a user copies. Async only because of the backend probe — the
 *  collector itself is synchronous, so a caller that cannot await (or does
 *  not care which server answered) can still call `collectDiagnostics()`. */
export async function diagnosticsText(): Promise<string> {
  return buildDiagnostics(collectDiagnostics(await probeBackend()));
}
