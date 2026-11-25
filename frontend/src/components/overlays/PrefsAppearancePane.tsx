// Preferences ▸ Appearance (split out of PreferencesDialog.tsx, PREFS_AUDIT
// lane 1). Lazy with the rest of the dialog.

import { ACCENT_SWATCHES as ACCENTS } from "../../store/accentSwatches";
import { useApp } from "../../store/useApp";
import { SegmentedControl } from "../primitives/SegmentedControl";
import { Switch } from "../primitives/Switch";
import PrefRow from "./PrefRow";

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export default function PrefsAppearancePane() {
  const p = useApp((s) => s);
  const setPref = useApp((s) => s.setPref);
  return (
    <>
      <PrefRow label="Theme" hint="System follows your OS; the title-bar button and Toggle theme switch between light and dark">
        <SegmentedControl
          options={["System", "Dark", "Light"]}
          value={p.themeMode === "light" ? "Light" : p.themeMode === "dark" ? "Dark" : "System"}
          onChange={(v) => setPref("themeMode", v.toLowerCase())}
        />
      </PrefRow>
      <PrefRow label="Accent color" hint="a tint, not a reskin">
        <div className="qzk-accent-swatches">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              className={`qzk-swatch${p.accent === a.id ? " on" : ""}`}
              style={{ ["--sw"]: a.c } as React.CSSProperties}
              title={a.id}
              onClick={() => setPref("accent", a.id)}
            >
              <span className="dot" style={{ background: a.c }} />
              {a.id}
            </button>
          ))}
        </div>
      </PrefRow>
      <PrefRow label="Density" hint="row height · padding · text">
        <SegmentedControl
          options={["Compact", "Regular", "Comfy"]}
          value={cap(p.density)}
          onChange={(v) => setPref("density", v.toLowerCase())}
        />
      </PrefRow>
      <PrefRow label="Reduce motion" hint="disable transitions">
        <Switch aria-label="Reduce motion" checked={p.reduceMotion} onChange={(v) => setPref("reduceMotion", v)} />
      </PrefRow>
    </>
  );
}
