// The Appearance dropdown's body (theme · accent · density · palette · the
// dash/marker switch · "All preferences…"), split out of AppearanceMenu.tsx
// by bundle diet slice 26 (`plans/BUNDLE_HEADROOM.md`). The gear button, the
// open flag, outside-click and Escape stay in AppearanceMenu.tsx, which is
// part of the always-visible title bar; this panel renders only after a click
// on the gear, so it loads on demand and is warmed once the title bar has
// mounted. See AppearanceMenu.tsx for the loading and failure rules.

import { PALETTES } from "../../lib/palettes";
import { isCalcOnlyView } from "../../lib/viewMode";
import { type Accent, type Density, type Theme, useApp } from "../../store/useApp";
import { Select } from "../primitives";
import { formatShortcut, isMacPlatform } from "../../lib/shortcutFormat";

const THEMES: Theme[] = ["dark", "light"];
const ACCENTS: Accent[] = ["violet", "teal", "ocean", "amber", "rose"];
const DENSITIES: Density[] = ["compact", "regular", "comfy"];
const opts = (xs: string[]) => xs.map((v) => ({ value: v, label: v }));
const PALETTE_OPTS = PALETTES.map((p) => ({ value: p.value, label: p.label }));

// Resolved once at module load — the host platform does not change.
const IS_MAC = isMacPlatform();

export default function AppearancePanel({ onClose }: { onClose: () => void }) {
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

  return (
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
      <Select aria-label="Theme" options={opts(THEMES)} value={theme} onChange={(e) => setTheme(e.target.value as Theme)} />
      <label className="qzk-field-lbl" style={{ marginTop: 4 }}>
        Accent
      </label>
      <Select aria-label="Accent" options={opts(ACCENTS)} value={accent} onChange={(e) => setAccent(e.target.value as Accent)} />
      <label className="qzk-field-lbl" style={{ marginTop: 4 }}>
        Density
      </label>
      <Select
        aria-label="Density"
        options={opts(DENSITIES)}
        value={density}
        onChange={(e) => setDensity(e.target.value as Density)}
      />
      <label className="qzk-field-lbl" style={{ marginTop: 4 }}>
        Series palette
      </label>
      <Select
        aria-label="Palette"
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
          after `npm ci` (2026-09-13, third review round): 920,133 B with the
          import, 920,031 B with this markup — 102 B. (Predicted at ~590 B by
          the first review off the original commit's module graph, measured
          at 74 B by the first rework and 111 B by the second, each off its
          own; the number moves with the graph, so it is re-measured every
          round rather than quoted.) Same `qz-check` markup the primitive
          emits.

          2026-11-13 (bundle diet slice 26): this dropdown is no longer
          eager. It moved out of AppearanceMenu.tsx into this lazily loaded
          panel, so the byte argument above no longer binds; the markup is
          kept as measured and tested. */}
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
            onClose();
            setPrefsOpen(true);
          }}
        >
          <span>All preferences…</span>
          <span className="qz-shortcut">{formatShortcut("⌘,", IS_MAC)}</span>
        </button>
      )}
    </div>
  );
}
