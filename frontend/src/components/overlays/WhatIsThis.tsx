// "What is this?" inspect mode (GUI_INTERACTION #17, the last Help sub-item).
// A toggle (Help ▸ What is this?) that turns the app's latent hover-help into
// a visible, explorable layer: every control carrying help text is outlined,
// and TooltipLayer reveals that text INSTANTLY (no dwell) while the mode is on.
//
// The design deliberately dodges the "feels broken when under-populated" trap
// that a scatter-data-help-everywhere approach hits: it reuses the existing
// [data-tip]/[data-tip-desc] attributes (already on the toolbar + menus) and
// OUTLINES exactly what is documented, so an undocumented control simply isn't
// highlighted rather than looking like a dead help target. Coverage then grows
// by adding [data-tip] to more controls over time, never by shipping empty
// targets.
//
// This component owns only the mode's chrome (the <html> flag CSS keys off,
// the hint badge, Esc/click-out exit). The instant-reveal lives in
// TooltipLayer, which reads the same store flag.

import { useEffect } from "react";
import { createPortal } from "react-dom";

import { useHelp } from "../../store/help";

export default function WhatIsThis() {
  const on = useHelp((s) => s.whatIsThis);
  const setOn = useHelp((s) => s.setWhatIsThis);

  // Flag the document root so the stylesheet can outline [data-tip] targets
  // and swap the cursor. Cleared on unmount / when the mode turns off.
  useEffect(() => {
    const root = document.documentElement;
    if (on) root.setAttribute("data-help-mode", "");
    else root.removeAttribute("data-help-mode");
    return () => root.removeAttribute("data-help-mode");
  }, [on]);

  // Esc exits — capture phase, but only act while the mode is on so it never
  // steals Escape from a dialog/menu (which the mode is mutually exclusive
  // with anyway, since opening any of them turns the mode off).
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOn(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [on, setOn]);

  if (!on) return null;
  return createPortal(
    <div className="qzk-whatis-badge" role="status">
      <span className="qzk-whatis-dot">?</span>
      <span>Point at a highlighted control to see what it does</span>
      <button className="qzk-whatis-exit" onClick={() => setOn(false)}>
        Done <kbd>Esc</kbd>
      </button>
    </div>,
    document.body,
  );
}
