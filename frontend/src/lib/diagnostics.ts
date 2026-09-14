// P3.4 — the copyable diagnostic bundle.
//
// WHAT THIS DELIBERATELY DOES NOT CONTAIN, and why the omission is the point.
// A researcher pasting this into an email or a GitHub issue hands over
// everything in it. In this app the sensitive material is not credentials, it
// is the science: unpublished sample names, a column label naming a
// collaborator's compound, an absolute path exposing a project directory, and
// the measurements themselves. So the bundle carries SHAPE — counts, sizes,
// settings — and never content. `diagnostics.test.ts` feeds a snapshot
// stuffed with exactly those and fails if any survives.
//
// The same rule decides the session-health section (2026-09-14): the STATE of
// autosave, recovery, in-flight work and recent notifications is shape and
// belongs here; the message text attached to any of them is free text written
// by a call site that was never asked to keep it publishable — an autosave
// failure reason, a toast naming the file that would not open — and stays out.
// Those texts are on screen (the status-bar banner, the toast) where the user
// can read them and quote them deliberately.
//
// Pure over an explicit snapshot rather than reaching into the store, so the
// redaction is testable without mounting an app, and so the collector (which
// must touch `navigator`, `window` and `localStorage`) stays separate and
// thin. `collectDiagnostics` in store/diagnostics.ts is that collector.

/** Everything the bundle is allowed to know. Assembling this is the ONLY
 *  place a decision about what to expose gets made — if a field is not here,
 *  it cannot leak. */
export interface DiagnosticsSnapshot {
  /** ISO timestamp, supplied by the caller so the builder stays pure. */
  takenAt: string;
  /** Which build produced this report. Supplied by the collector (the values
   *  are injected at build time; see lib/buildInfo.ts) rather than read here,
   *  so this module stays a pure function of its argument. */
  build: { version: string; sha: string };
  platform: {
    userAgent: string;
    language: string;
    /** True when running in the desktop shell rather than a browser tab. */
    desktop: boolean;
  };
  display: { width: number; height: number; devicePixelRatio: number };
  environment: {
    theme: string;
    density: string;
    /** The Preferences ▸ Appearance switch. */
    reduceMotionPref: boolean;
    /** The OS-level `prefers-reduced-motion` media query. Independent of the
     *  preference above (see styles/index.css), and a motion complaint is
     *  unreadable without knowing which of the two was on. */
    reduceMotionOS: boolean;
    accent: string;
  };
  /** Counts and extents only — never a name, label, or value. */
  workspace: {
    datasets: number;
    workbooks: number;
    folders: number;
    figures: number;
    openWindows: number;
    largestDatasetRows: number;
    largestDatasetColumns: number;
    datasetsWithFormulas: number;
    datasetsWithCorrections: number;
    datasetsWithErrorRoles: number;
    stageTab: string;
  };
  /** Vetted persisted slots by key and byte size. Contents are never read,
   *  and a key that is not on `lib/storageKeys.ts`'s allowlist never gets
   *  here — it is aggregated into `otherStorage` instead. */
  storage: readonly { key: string; bytes: number }[];
  /** Everything under the app's namespace that the allowlist does not name,
   *  reduced to a count and a byte total. Present so an unrecognised slot
   *  filling the quota is still visible, without printing its name. */
  otherStorage: { slots: number; bytes: number };
  /** The server this SPA is talking to. A desktop launch pairs a bundled SPA
   *  with a bundled backend, so a version mismatch here is a real and
   *  otherwise invisible cause of "the button does nothing" — the frontend
   *  build alone cannot show it. `reachable: false` covers both a dead
   *  backend and an offline/file-served page, which is itself the answer to
   *  a whole class of reports. Server-generated constants, never user data. */
  backend: { reachable: boolean; app: string | null; version: string | null };
  /** How this session is doing right now: states, counts and ages only — no
   *  message text (see `store/toasts.ts`'s counter header for why the
   *  obvious "last N messages" would undo this module's whole promise, and
   *  `session.autosaveFailing` below for the same decision about the autosave
   *  reason string). */
  session: {
    /** null = nothing has been autosaved yet this session. */
    lastAutosaveAgeSec: number | null;
    /** True when the last attempt failed and no success has followed. */
    autosaveFailing: boolean;
    /** Autosave generations currently retained. */
    autosaveGenerations: number;
    /** A crash-recovery choice is on screen, unanswered. */
    recoveryPromptOpen: boolean;
    /** Operations registered in `store/pendingOps.ts` right now. */
    pendingOps: number;
    /** Notifications raised this session, by outcome — true cumulative
     *  counts (`store/toasts.ts`'s monotonic counters), never a windowed or
     *  evicted sample: "total 50" always means exactly 50, not "at least the
     *  last 50 of some larger number". */
    notifications: { total: number; errors: number; lastErrorAgeSec: number | null };
  };
}

/** Bumped when the rendered layout changes in a way that would break a
 *  consumer parsing it. Owned by the builder, not the snapshot: the format is
 *  this module's, and a collector must not be able to misreport it. */
export const DIAGNOSTICS_SCHEMA_VERSION = 2;

function section(title: string, rows: readonly (readonly [string, string])[]): string {
  const width = Math.max(...rows.map(([k]) => k.length));
  return [`## ${title}`, ...rows.map(([k, v]) => `${k.padEnd(width)}  ${v}`)].join("\n");
}

const yesNo = (b: boolean): string => (b ? "yes" : "no");

/** `backend.app`/`backend.version` are server-generated constants for THIS
 *  app's backend, but the fetch that fills them is same-origin-relative —
 *  whatever process is actually serving the SPA answers `/api/health`, and
 *  `store/backendHealth.ts`'s header notes the sibling `fermiviewer` serves
 *  the same shape on the same default port. Pasted verbatim with no clamp,
 *  a value containing e.g. `"\n## Session health"` could break this report's
 *  column layout or forge a section heading. Strip control characters
 *  (newlines included) and cap the length — the identity string is still
 *  legible; it just cannot rewrite the report around it. */
function sanitizeServerString(v: string): string {
  return v.replace(/[\x00-\x1f\x7f]+/g, " ").trim().slice(0, 64);
}

/** Ages, never timestamps: "41 s ago" answers the triage question ("how long
 *  ago did this happen relative to the report?") and stays readable when the
 *  report is pasted a day later — a raw timestamp reads as "when" only next
 *  to `taken at` (below), and goes stale for that purpose the moment the
 *  report is no longer fresh. (Not a privacy property: `taken at` already
 *  prints the exact wall-clock moment, so every age here is trivially
 *  reconstructible relative to it — readability, not concealment, is the
 *  reason.) */
const age = (seconds: number | null): string => (seconds === null ? "never" : `${seconds} s ago`);

/** Render a plain-text diagnostic bundle. Deterministic: the same snapshot
 *  always produces the same text, so it diffs cleanly across reports. */
export function buildDiagnostics(s: DiagnosticsSnapshot): string {
  const w = s.workspace;
  return [
    "# Quantized diagnostics",
    "",
    "Shape and settings only — no dataset names, column labels, file paths,",
    "measured values, stored contents, or notification text. Safe to paste",
    "into an issue.",
    "",
    section("Session", [
      ["taken at", s.takenAt],
      ["version", `${s.build.version} (${s.build.sha})`],
      ["report schema", String(DIAGNOSTICS_SCHEMA_VERSION)],
      ["shell", s.platform.desktop ? "desktop" : "browser"],
      ["language", s.platform.language],
      ["user agent", s.platform.userAgent],
      [
        "backend",
        s.backend.reachable
          ? `${s.backend.app ? sanitizeServerString(s.backend.app) : "unknown app"} ${
              s.backend.version ? sanitizeServerString(s.backend.version) : "unknown version"
            }`
          : "unreachable",
      ],
    ]),
    "",
    section("Display", [
      ["size", `${s.display.width}×${s.display.height}`],
      ["device pixel ratio", String(s.display.devicePixelRatio)],
    ]),
    "",
    section("Appearance", [
      ["theme", s.environment.theme],
      ["density", s.environment.density],
      ["accent", s.environment.accent],
      ["reduce motion (OS)", yesNo(s.environment.reduceMotionOS)],
      ["reduce motion (pref)", yesNo(s.environment.reduceMotionPref)],
    ]),
    "",
    section("Workspace", [
      ["datasets", String(w.datasets)],
      ["workbooks", String(w.workbooks)],
      ["folders", String(w.folders)],
      ["figures", String(w.figures)],
      ["open windows", String(w.openWindows)],
      ["stage tab", w.stageTab],
      ["largest dataset", `${w.largestDatasetRows} rows × ${w.largestDatasetColumns} columns`],
      ["with formulas", String(w.datasetsWithFormulas)],
      ["with corrections", String(w.datasetsWithCorrections)],
      ["with error roles", String(w.datasetsWithErrorRoles)],
    ]),
    "",
    section("Session health", [
      ["autosave", s.session.autosaveFailing ? "FAILING" : "ok"],
      ["last autosave", age(s.session.lastAutosaveAgeSec)],
      ["generations kept", String(s.session.autosaveGenerations)],
      ["recovery prompt open", yesNo(s.session.recoveryPromptOpen)],
      ["operations in flight", String(s.session.pendingOps)],
      ["notifications", String(s.session.notifications.total)],
      ["of those, errors", String(s.session.notifications.errors)],
      ["last error", age(s.session.notifications.lastErrorAgeSec)],
    ]),
    "",
    section("Stored slots (key and size only)", [
      ...s.storage.map((e) => [e.key, `${e.bytes} bytes`] as const),
      // Always rendered, even at zero: "0 slots" says the allowlist covered
      // everything, whereas an omitted line is indistinguishable from a
      // report built before this section existed.
      [
        "(unrecognised)",
        `${s.otherStorage.slots} slots, ${s.otherStorage.bytes} bytes`,
      ] as const,
    ]),
    "",
  ].join("\n");
}
