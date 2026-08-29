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
  /** Persisted slots by key and byte size. Contents are never read. */
  storage: readonly { key: string; bytes: number }[];
}

function section(title: string, rows: readonly (readonly [string, string])[]): string {
  const width = Math.max(...rows.map(([k]) => k.length));
  return [`## ${title}`, ...rows.map(([k, v]) => `${k.padEnd(width)}  ${v}`)].join("\n");
}

const yesNo = (b: boolean): string => (b ? "yes" : "no");

/** Render a plain-text diagnostic bundle. Deterministic: the same snapshot
 *  always produces the same text, so it diffs cleanly across reports. */
export function buildDiagnostics(s: DiagnosticsSnapshot): string {
  const w = s.workspace;
  return [
    "# Quantized diagnostics",
    "",
    "Shape and settings only — no dataset names, column labels, file paths,",
    "measured values, or stored contents. Safe to paste into an issue.",
    "",
    section("Session", [
      ["taken at", s.takenAt],
      ["shell", s.platform.desktop ? "desktop" : "browser"],
      ["language", s.platform.language],
      ["user agent", s.platform.userAgent],
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
    section(
      "Stored slots (key and size only)",
      s.storage.length
        ? s.storage.map((e) => [e.key, `${e.bytes} bytes`] as const)
        : [["(none)", ""] as const],
    ),
    "",
  ].join("\n");
}
