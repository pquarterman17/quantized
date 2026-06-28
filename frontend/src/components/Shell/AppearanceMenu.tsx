// Appearance dropdown (theme · accent · density) in the title bar — replaces the
// old Inspector "Appearance" card. Click the gear to open; click-outside or Esc
// closes (same pattern as the MenuBar).

import { useEffect, useRef, useState } from "react";

import { PALETTES } from "../../lib/palettes";
import { type Accent, type Density, type Theme, useApp } from "../../store/useApp";
import { Select } from "../primitives";

const THEMES: Theme[] = ["dark", "light"];
const ACCENTS: Accent[] = ["violet", "teal", "ocean", "amber", "rose"];
const DENSITIES: Density[] = ["compact", "regular", "comfy"];
const opts = (xs: string[]) => xs.map((v) => ({ value: v, label: v }));
const PALETTE_OPTS = PALETTES.map((p) => ({ value: p.value, label: p.label }));

export default function AppearanceMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const accent = useApp((s) => s.accent);
  const setAccent = useApp((s) => s.setAccent);
  const density = useApp((s) => s.density);
  const setDensity = useApp((s) => s.setDensity);
  const palette = useApp((s) => s.palette);
  const setPalette = useApp((s) => s.setPalette);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        className={`qz-icon-btn${open ? " active" : ""}`}
        title="Appearance (theme · accent · density · palette)"
        onClick={() => setOpen((o) => !o)}
      >
        ⚙
      </button>
      {open && (
        <div
          className="qzk-glass"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            width: 184,
            padding: 10,
            zIndex: 50,
            display: "grid",
            gap: 6,
          }}
        >
          <label className="qzk-field-lbl">Theme</label>
          <Select options={opts(THEMES)} value={theme} onChange={(e) => setTheme(e.target.value as Theme)} />
          <label className="qzk-field-lbl" style={{ marginTop: 4 }}>
            Accent
          </label>
          <Select options={opts(ACCENTS)} value={accent} onChange={(e) => setAccent(e.target.value as Accent)} />
          <label className="qzk-field-lbl" style={{ marginTop: 4 }}>
            Density
          </label>
          <Select
            options={opts(DENSITIES)}
            value={density}
            onChange={(e) => setDensity(e.target.value as Density)}
          />
          <label className="qzk-field-lbl" style={{ marginTop: 4 }}>
            Series palette
          </label>
          <Select
            options={PALETTE_OPTS}
            value={palette}
            onChange={(e) => setPalette(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
