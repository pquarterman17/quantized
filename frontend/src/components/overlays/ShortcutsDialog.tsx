// Keyboard + mouse cheat-sheet (#20, MATLAB "Help"). A read-only modal driven by
// the store `shortcutsOpen` flag; opened from the Help menu, the command palette,
// or the `?` key. Content lives in lib/shortcuts (pure, testable); this is just
// the renderer. Backdrop click / Esc / the Close button dismiss it.

import { useId, useRef } from "react";

import { isMacPlatform, shortcutGroupsFor } from "../../lib/shortcuts";
import { Button } from "../primitives";
import { useApp } from "../../store/useApp";
import { useDialogFocus } from "./useDialogFocus";
import { useEscapeSurface } from "../../lib/escapeStack";

const IS_MAC = isMacPlatform();

export default function ShortcutsDialog() {
  const open = useApp((s) => s.shortcutsOpen);
  const setOpen = useApp((s) => s.setShortcutsOpen);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  // Esc closes even when focus isn't inside the dialog. R1 (P3.3): kept as its
  // own window-capture listener rather than joining `lib/escapeStack.ts` — this
  // is a true backdrop modal (blocks the pointer entirely), so it must always
  // win regardless of anything mounted behind it, exactly like ConfirmDialog
  // and RecoveryChoiceDialog. Window-capture already guarantees that (it runs
  // ahead of the registry's window-BUBBLE listener), so joining the registry
  // would add ordering machinery this dialog never needs.
  // FIXED 2026-09-19 (BUG-018, P3.3 round 9). Escape now goes through the
  // app's one ordered registry on its `modal` layer, so the innermost open
  // dialog closes and nothing below it acts on the same keystroke. The
  // per-dialog `window`-capture listener this replaces used
  // `stopPropagation()`, which does not stop a same-node, same-phase sibling,
  // so two open dialogs both closed on ONE Escape.
  useEscapeSurface(
    "modal",
    () => {
      setOpen(false);
      return true;
    },
    open,
  );

  // R1: focus-in, Tab trap, restore-to-opener. A read-only sheet with one
  // real control (Close), so the shared hook's default landing spot — the
  // first focusable element — is already the meaningful one.
  useDialogFocus(dialogRef, open);

  if (!open) return null;
  const groups = shortcutGroupsFor(IS_MAC);

  return (
    <div className="qz-overlay-backdrop" onMouseDown={() => setOpen(false)}>
      <div
        className="qzk-glass qz-dialog qzk-shortcuts"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id={titleId}>Keyboard &amp; mouse shortcuts</h2>
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
