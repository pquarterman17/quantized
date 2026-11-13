// Appearance dropdown (theme · accent · density) in the title bar — replaces the
// old Inspector "Appearance" card. Click the gear to open; click-outside or Esc
// closes (same pattern as the MenuBar).
//
// Bundle diet slice 26 (`plans/BUNDLE_HEADROOM.md`): the dropdown's body is
// ./AppearancePanel.tsx, loaded on demand. The gear, the open flag and the
// outside-click and Escape handling stay here, because the title bar is on
// screen from first paint. The panel is fetched once the title bar has
// mounted (the effect below), so the first click renders it from the module
// cache; a click before that fetch lands shows it when the fetch does,
// committed synchronously by `useRegionLoaded` rather than through
// Suspense's retry throttle. A panel that will not load closes the dropdown
// and says so in a toast; the next click tries again.

import { useEffect, useRef, useState } from "react";

import { useEscapeSurface } from "../../lib/escapeStack";
import { lazyRegion, useRegionLoaded } from "../../lib/lazyRegion";
import { toast } from "../../store/toasts";

const Panel = lazyRegion(() => import("./AppearancePanel"), "Appearance");

export default function AppearanceMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Warm only; a failed fetch is not cached, and a click reports its own.
    Panel.preload().catch(() => {});
  }, []);
  const ready = useRegionLoaded(Panel, open, () => {
    setOpen(false);
    toast("Could not load the Appearance menu. Try again.", "danger");
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  // Escape closes the dropdown (GUI_INTERACTION #9). Round 4: this was a plain
  // document-keydown listener with no `preventDefault`, so the shared registry
  // also walked and a surface below acted on the same keystroke. As a
  // `menu`-layer surface it is the top of the ladder — one Escape, one action.
  useEscapeSurface(
    "menu",
    () => {
      setOpen(false);
      return true;
    },
    open,
  );

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        aria-label="Appearance"
        className={`qz-icon-btn${open ? " active" : ""}`}
        title="Appearance (theme · accent · density · palette)"
        onClick={() => setOpen((o) => !o)}
      >
        ⚙
      </button>
      {open && (ready || Panel.loaded()) && <Panel onClose={() => setOpen(false)} />}
    </div>
  );
}
