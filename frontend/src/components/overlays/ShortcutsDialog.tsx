// Keyboard + mouse cheat-sheet (#20, MATLAB "Help"). A read-only modal driven by
// the store `shortcutsOpen` flag; opened from the Help menu, the command palette,
// or the `?` key. Content lives in lib/shortcuts (pure, testable); this is just
// the renderer. Backdrop click / Esc / the Close button dismiss it.

import { useEffect } from "react";

import { shortcutGroupsFor } from "../../lib/shortcuts";
import { Button } from "../primitives";
import { useApp } from "../../store/useApp";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export default function ShortcutsDialog() {
  const open = useApp((s) => s.shortcutsOpen);
  const setOpen = useApp((s) => s.setShortcutsOpen);

  // Esc closes even when focus isn't inside the dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, setOpen]);

  if (!open) return null;
  const groups = shortcutGroupsFor(IS_MAC);

  return (
    <div className="qz-overlay-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="qzk-glass qz-dialog qzk-shortcuts" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Keyboard &amp; mouse shortcuts</h2>
        <div className="qzk-sc-cols">
          {groups.map((g) => (
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
        <div className="qz-btn-row">
          <Button variant="primary" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
