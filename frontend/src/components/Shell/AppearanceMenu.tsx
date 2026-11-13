// Appearance dropdown (theme · accent · density) in the title bar — replaces the
// old Inspector "Appearance" card. Click the gear to open; click-outside or Esc
// closes (same pattern as the MenuBar). The panel itself is a lazy chunk
// (AppearancePanel.tsx), loaded on first open (eager-bundle budget).

import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { useEscapeSurface } from "../../lib/escapeStack";

const AppearancePanel = lazy(() => import("./AppearancePanel"));

export default function AppearanceMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
      {open && (
        <Suspense fallback={null}>
          <AppearancePanel onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
