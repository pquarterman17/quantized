// Preferences ▸ General (PREFS_AUDIT lane 4): the workflow and safety settings
// that used to be hidden constants, the two confirmations (owner decision
// 2026-11-25, both ON by default) and the first-run hints. Backed by the
// `qz.workflowPrefs` slot (lib/workflowPrefs.ts). Every default except the two
// confirmations is today's behaviour; ranges are provisional, owner to confirm.

import { WORKFLOW_RANGES, clampWorkflow, workflowPrefsSlot, type WorkflowNumKey, type WorkflowPrefs } from "../../lib/workflowPrefs";
import { setWorkflowPrefs } from "../../lib/workflowPrefsEdit";
import { SegmentedControl } from "../primitives/SegmentedControl";
import { Switch } from "../primitives/Switch";
import PrefNumberRow from "./PrefNumberRow";
import PrefRow from "./PrefRow";

type BoolKey = "confirmUnsavedClose" | "confirmReplaceWorkspace" | "showFirstRunHints" | "showTipAtStart" | "startFromLastUsed";

/** A number inside the key's range (whole for integer keys), else null. */
const inRange = (key: WorkflowNumKey) => (t: string): number | null => {
  const n = Number(t);
  return Number.isFinite(n) && clampWorkflow(key, n) === n ? n : null;
};

function Num({ k, label, hint, unit }: { k: WorkflowNumKey; label: string; hint?: string; unit?: string }) {
  const value = workflowPrefsSlot.use()[k];
  const [lo, hi] = WORKFLOW_RANGES[k];
  return (
    <PrefNumberRow
      label={label}
      hint={hint}
      value={value}
      unit={unit}
      parse={inRange(k)}
      range={`${WORKFLOW_RANGES[k][2] ? "a whole number " : "a number "}from ${lo} to ${hi}`}
      onSave={(n) => setWorkflowPrefs({ [k]: n } as Partial<WorkflowPrefs>)}
    />
  );
}

function Toggle({ k, label, hint }: { k: BoolKey; label: string; hint?: string }) {
  const checked = workflowPrefsSlot.use()[k];
  return (
    <PrefRow label={label} hint={hint}>
      <Switch aria-label={label} checked={checked} onChange={(v) => setWorkflowPrefs({ [k]: v })} />
    </PrefRow>
  );
}

const STARTUP = [
  { value: "welcome", label: "Welcome screen" },
  { value: "reopen", label: "Reopen last session" },
] as const;

function StartupRow() {
  const onStartup = workflowPrefsSlot.use().onStartup;
  return (
    <PrefRow
      label="On startup"
      hint="Welcome screen offers “Restore last session” and keeps it saved. After an unexpected close the choice is offered either way"
    >
      <SegmentedControl aria-label="On startup" options={[...STARTUP]} value={onStartup} onChange={(v) => setWorkflowPrefs({ onStartup: v })} />
    </PrefRow>
  );
}

export default function PrefsGeneralPane() {
  return (
    <>
      <StartupRow />
      <Toggle
        k="confirmUnsavedClose"
        label="Warn before closing with unsaved changes"
        hint="the browser asks before a close or reload while the project has unsaved edits"
      />
      <Toggle
        k="confirmReplaceWorkspace"
        label="Confirm before replacing the workspace"
        hint="opening a project over a non-empty workspace asks first"
      />
      <Num k="autosaveDebounceSec" label="Autosave delay" unit="s" hint="wait after the last edit before saving a recovery copy (default 0.8)" />
      <Num k="autosaveGenerations" label="Recovery copies kept" hint="autosave generations (default 3)" />
      <Num k="autosaveRetentionDays" label="Recovery copy retention" unit="days" hint="older copies are dropped, the newest always stays (default 30)" />
      <Num k="undoDepth" label="Undo steps" hint="applies to new edits; the Edit menu lists the last 20 (default 50)" />
      <Num k="recentFilesMax" label="Recent files kept" hint="File ▸ Recent (default 12)" />
      <Num k="recentProjectsMax" label="Recent projects kept" hint="File ▸ Recent projects (default 12)" />
      <Num k="recentFoldersMax" label="Recent folders kept" hint="unpinned working folders (default 8)" />
      <Toggle k="startFromLastUsed" label="Start tools with their last-used settings" hint="a tool's preset bar fills its form from the last successful run when it opens (off: the tool opens with its defaults and offers “Last used”)" />
      <Toggle k="showFirstRunHints" label="Show first-run hints" hint="the interaction tips card on an empty workspace; Help ▸ Show interaction hints always opens it" />
      <Toggle k="showTipAtStart" label="Show a tip at start" hint="a tip of the day opens at launch (off by default); Help ▸ Tip of the day always opens one" />
    </>
  );
}
