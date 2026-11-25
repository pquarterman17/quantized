// The Preferences footer (PREFS_AUDIT P1-3): Reset this tab, Reset all, each
// behind a confirm, and Done. Lazy with the dialog.

import { askConfirm } from "./ConfirmDialog";
import { resetAllPrefs, resetSpec } from "../../lib/prefsReset";
import { Button } from "../primitives";
import { PREFS_TABS, type PrefsTabDef } from "./prefsTabs";

export default function PrefsResetBar({
  tab,
  onDone,
  onReset,
}: {
  tab: PrefsTabDef | undefined;
  onDone: () => void;
  /** After a reset: remount the pane so local copies re-read their values. */
  onReset: () => void;
}) {
  const spec = tab?.reset;
  const resetTab = async () => {
    if (!tab || !spec) return;
    const ok = await askConfirm(
      `Reset ${tab.id} preferences?`,
      `Every setting on the ${tab.id} tab goes back to its default. Other tabs, your templates and your data are unchanged.`,
      "Reset tab",
      true,
    );
    if (!ok) return;
    resetSpec(spec);
    onReset();
  };
  const resetAll = async () => {
    const ok = await askConfirm(
      "Reset all preferences?",
      "Every preference on every tab, and the panel widths, go back to their defaults. Templates, recipes, recent files and your data are unchanged.",
      "Reset all",
      true,
    );
    if (!ok) return;
    resetAllPrefs(PREFS_TABS.flatMap((t) => (t.reset?.extra ? [t.reset.extra] : [])));
    onReset();
  };
  return (
    <div className="qzk-prefs-foot">
      <span className="qzk-pref-hint">
        Changes apply immediately and are kept for you on this computer, whichever port or window Quantized runs in.
        The window layout itself is saved with the project.
      </span>
      <Button size="sm" disabled={!spec} onClick={() => void resetTab()}>
        Reset tab…
      </Button>
      <Button size="sm" onClick={() => void resetAll()}>
        Reset all…
      </Button>
      <Button variant="primary" size="sm" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}
