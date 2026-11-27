// Workflow, safety and startup preferences (PREFS_AUDIT lane 4, P1-8 / P1-9 /
// P1-10 / P2-17): the hidden constants that were hardcoded (autosave debounce,
// generations and retention, undo depth, recents caps), the two confirmations
// (owner decision 2026-11-25, both ON by default), the first-run hints card
// and the import wizard's remembered settings. One slot, `qz.workflowPrefs`
// (lib/prefSlots.ts), read at CALL time by its consumers, never copied.
//
// Every default equals the value that was hardcoded, except the two
// confirmations. Ranges are provisional, owner to confirm; out-of-range stored
// values are clamped on load (a hand-edited slot cannot starve autosave or
// make undo useless). Eager and tiny on purpose: store/history.ts and the
// recents stores read it.

import { definePrefSlot, parseByDefaults } from "./prefSlots";
import type { StartupMode } from "./startupDecision";

/** The import wizard's last-used layout (opt-in memory, P1-10). */
export interface ImportMemory {
  delimiter: string;
  header_line: number | null;
  units_line: number | null;
}

export const WORKFLOW_DEFAULTS = {
  /** Autosave waits this long after the last edit (was 800 ms). */
  autosaveDebounceSec: 0.8,
  /** Recovery generations kept (was MAX_GENERATIONS = 3). */
  autosaveGenerations: 3,
  /** Days a generation stays offered (was 30). */
  autosaveRetentionDays: 30,
  /** Undo / redo steps kept (was HISTORY_DEPTH = 50). */
  undoDepth: 50,
  recentFilesMax: 12,
  recentProjectsMax: 12,
  recentFoldersMax: 8,
  /** Owner decision 2026-11-25: warn before closing or reloading with unsaved changes. */
  confirmUnsavedClose: true,
  /** Owner decision 2026-11-25: confirm before an open replaces a non-empty workspace. */
  confirmReplaceWorkspace: true,
  /** Owner decision 2026-11-26: what a launch shows when an autosaved session
   *  exists. "welcome" (default): the welcome screen, with a Restore action;
   *  "reopen": bring the last session back silently, as before. A crash is
   *  offered on the welcome screen either way (lib/startupDecision.ts). */
  onStartup: "welcome" as StartupMode,
  /** The first-run interaction hints card (was always shown once). */
  showFirstRunHints: true,
  /** Opt-in (today's behaviour is a fresh "auto" per import). */
  rememberImportSettings: false,
  importMemory: null as ImportMemory | null,
  /** Opt-in: a tool opens with its last-run settings (never a silent default change). */
  startFromLastUsed: false,
};
export type WorkflowPrefs = typeof WORKFLOW_DEFAULTS;

/** Provisional ranges, owner to confirm: [min, max, integer?]. */
export const WORKFLOW_RANGES = {
  autosaveDebounceSec: [0.4, 10, false],
  autosaveGenerations: [1, 10, true],
  autosaveRetentionDays: [1, 365, true],
  undoDepth: [10, 200, true],
  recentFilesMax: [1, 50, true],
  recentProjectsMax: [1, 50, true],
  recentFoldersMax: [1, 50, true],
} as const;
export type WorkflowNumKey = keyof typeof WORKFLOW_RANGES;

/** `v` clamped into the key's range (integers rounded); a non-number is the default. */
export function clampWorkflow(key: WorkflowNumKey, v: unknown): number {
  const [lo, hi, int] = WORKFLOW_RANGES[key];
  if (typeof v !== "number" || !Number.isFinite(v)) return WORKFLOW_DEFAULTS[key];
  return Math.min(hi, Math.max(lo, int ? Math.round(v) : v));
}

const line = (v: unknown): boolean => v === null || typeof v === "number";
const base = parseByDefaults(WORKFLOW_DEFAULTS);

function parse(raw: Record<string, unknown>): WorkflowPrefs {
  const out = base(raw);
  for (const k of Object.keys(WORKFLOW_RANGES) as WorkflowNumKey[]) out[k] = clampWorkflow(k, raw[k]);
  out.onStartup = raw.onStartup === "reopen" ? "reopen" : "welcome"; // fail closed: anything else is the welcome screen
  const m = out.importMemory; // `base` kept any object: keep only a well-formed one
  if (m && !(typeof m.delimiter === "string" && line(m.header_line) && line(m.units_line))) out.importMemory = null;
  return out;
}

export const workflowPrefsSlot = definePrefSlot("qz.workflowPrefs", WORKFLOW_DEFAULTS, parse);
