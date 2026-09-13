// Appearance dropdown (theme · accent · density) in the title bar — replaces the
// old Inspector "Appearance" card. Click the gear to open; click-outside or Esc
// closes (same pattern as the MenuBar).

import { useEffect, useRef, useState } from "react";

import { PALETTES } from "../../lib/palettes";
import { isCalcOnlyView } from "../../lib/viewMode";
import { type Accent, type Density, type Theme, useApp } from "../../store/useApp";
import { Select } from "../primitives";
import { formatShortcut, isMacPlatform } from "../../lib/shortcuts";

const THEMES: Theme[] = ["dark", "light"];
const ACCENTS: Accent[] = ["violet", "teal", "ocean", "amber", "rose"];
const DENSITIES: Density[] = ["compact", "regular", "comfy"];
const opts = (xs: string[]) => xs.map((v) => ({ value: v, label: v }));
const PALETTE_OPTS = PALETTES.map((p) => ({ value: p.value, label: p.label }));

// Resolved once at module load — the host platform does not change.
const IS_MAC = isMacPlatform();

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
  const autoSeriesStyles = useApp((s) => s.autoSeriesStyles);
  const setPref = useApp((s) => s.setPref);
  const setPrefsOpen = useApp((s) => s.setPrefsOpen);

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
          {/* P3.3 non-colour encodings — deliberately right under the palette,
              because it is the same cycle: the palette varies hue, this varies
              dash + marker glyph so series stay tellable apart in greyscale, in
              print, and with a colour-vision deficiency. Off by default
              (opt-in); on, the Stage canvas, its legend swatch and the figure
              export it produces all resolve through one function
              (lib/seriesStyleCycle) at one display position.

              Spelled out rather than using `primitives/Checkbox`: this menu is
              EAGER and that component is not in the eager bundle (its header
              records that every other consumer is a lazy panel), so importing
              it pulls component + clsx wiring into the startup chunk for one
              static, never-disabled checkbox. Measured both ways on this tree
              after `npm ci` (2026-09-13): 919,701 B with the import, 919,590 B
              with this markup — 111 B. (The first review predicted ~590 B off
              the original commit's module graph and the first rework measured
              74 B off its own; the number moves with the graph, so it is
              re-measured rather than quoted.) Same `qz-check` markup the
              primitive emits. */}
          <label className="qz-check">
            <input
              type="checkbox"
              checked={autoSeriesStyles}
              onChange={(e) => setPref("autoSeriesStyles", e.target.checked)}
            />
            Vary dash &amp; marker
          </label>
          {/* Preferences (and the rest of the app shell it belongs to) isn't
              mounted in the calc-only shell (?view=calc, MAIN_PLAN #22) — the
              footer link would open a dialog nothing else in that shell
              expects. One guarded render rather than forking the component. */}
          {!isCalcOnlyView() && (
            <button
              className="qzk-menu-item"
              style={{ marginTop: 6 }}
              onClick={() => {
                setOpen(false);
                setPrefsOpen(true);
              }}
            >
              <span>All preferences…</span>
              <span className="qz-shortcut">{formatShortcut("⌘,", IS_MAC)}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
