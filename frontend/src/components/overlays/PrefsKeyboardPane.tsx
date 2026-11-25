// Preferences ▸ Keyboard: a read-only reference built from lib/shortcuts, so it
// cannot drift from the ? sheet (split out of PreferencesDialog.tsx).

import { isMacPlatform, shortcutGroupsFor } from "../../lib/shortcuts";

const IS_MAC = isMacPlatform();

export default function PrefsKeyboardPane() {
  return (
    <>
      <div className="qzk-pref-note">Reference only: shortcuts are fixed and cannot be rebound here.</div>
      <div className="qzk-sc-cols">
        {shortcutGroupsFor(IS_MAC).map((g) => (
          <div key={g.title} className="qzk-sc-group">
            <div className="qzk-sc-title">{g.title}</div>
            {g.items.map((s) => (
              <div key={s.keys} className="qzk-sc-row">
                <kbd className="qzk-kbd">{s.keys}</kbd>
                <span className="qzk-sc-desc">{s.desc}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
