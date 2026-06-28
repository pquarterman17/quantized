// Tabbed Preferences modal (design interaction layer, ⌘,). Driven by the store
// `prefsOpen` flag; every control calls the generic store `setPref`, which applies
// live (theme/accent/density/reduce-motion to <html>, sig-figs/notation to the
// number formatter) and persists to localStorage. Coexists with the Appearance
// menu — both write the same store. The Keyboard tab reuses lib/shortcuts so the
// reference can't drift from the ? sheet.

import { useEffect, useState } from "react";

import { shortcutGroupsFor } from "../../lib/shortcuts";
import { Button, SegmentedControl, Select, SliderRow, Switch } from "../primitives";
import { useApp } from "../../store/useApp";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

const TABS = ["Appearance", "Plot", "Interaction", "Numbers", "Keyboard"] as const;
type Tab = (typeof TABS)[number];

const ACCENTS: { id: string; c: string }[] = [
  { id: "violet", c: "oklch(0.7 0.17 295)" },
  { id: "teal", c: "oklch(0.74 0.13 185)" },
  { id: "ocean", c: "oklch(0.68 0.15 250)" },
  { id: "amber", c: "oklch(0.78 0.14 75)" },
  { id: "rose", c: "oklch(0.72 0.16 12)" },
];

const TRACE_OPTS = ["Line", "Line + markers", "Scatter", "Step"].map((v) => ({ value: v, label: v }));
const NOTATION_OPTS = [
  { value: "auto", label: "Auto" },
  { value: "scientific", label: "Scientific" },
  { value: "fixed", label: "Fixed" },
];

function PrefRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="qzk-pref-row">
      <div className="qzk-pref-lbl">
        {label}
        {hint && <span className="hint">{hint}</span>}
      </div>
      <div className="qzk-pref-ctl">{children}</div>
    </div>
  );
}

export default function PreferencesDialog() {
  const open = useApp((s) => s.prefsOpen);
  const setOpen = useApp((s) => s.setPrefsOpen);
  const setPref = useApp((s) => s.setPref);
  const p = useApp((s) => s);
  const [tab, setTab] = useState<Tab>("Appearance");

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
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

  return (
    <div className="qz-overlay-backdrop qzk-prefs-overlay" onMouseDown={() => setOpen(false)}>
      <div
        className="qzk-prefs"
        role="dialog"
        aria-label="Preferences"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="qzk-prefs-head">
          <span className="ttl">Preferences</span>
          <button className="qzk-prefs-x" title="Close (Esc)" onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>
        <div className="qzk-prefs-body">
          <nav className="qzk-prefs-nav">
            {TABS.map((t) => (
              <div
                key={t}
                className={`qzk-prefs-tab${tab === t ? " active" : ""}`}
                onClick={() => setTab(t)}
              >
                {t}
              </div>
            ))}
          </nav>
          <div className="qzk-prefs-pane">
            {tab === "Appearance" && (
              <>
                <PrefRow label="Theme">
                  <SegmentedControl
                    options={["Dark", "Light"]}
                    value={p.theme === "light" ? "Light" : "Dark"}
                    onChange={(v) => setPref("theme", v === "Light" ? "light" : "dark")}
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
                  <Switch checked={p.reduceMotion} onChange={(v) => setPref("reduceMotion", v)} />
                </PrefRow>
              </>
            )}
            {tab === "Plot" && (
              <>
                <PrefRow label="Default trace">
                  <Select
                    options={TRACE_OPTS}
                    value={p.defaultTrace}
                    onChange={(e) => setPref("defaultTrace", e.target.value)}
                  />
                </PrefRow>
                <PrefRow label="Default line width">
                  <div style={{ width: 160 }}>
                    <SliderRow
                      label="px"
                      value={p.defaultLineWidth}
                      min={0.5}
                      max={4}
                      step={0.5}
                      onChange={(v) => setPref("defaultLineWidth", v)}
                      format={(v) => v.toFixed(1)}
                    />
                  </div>
                </PrefRow>
                <PrefRow label="Grid lines" hint="default for the plot">
                  <Switch checked={p.defaultGrid} onChange={(v) => setPref("defaultGrid", v)} />
                </PrefRow>
                <PrefRow label="Antialias traces">
                  <Switch checked={p.antialias} onChange={(v) => setPref("antialias", v)} />
                </PrefRow>
              </>
            )}
            {tab === "Interaction" && (
              <>
                <PrefRow label="Mouse wheel" hint="over the plot">
                  <SegmentedControl
                    options={["Zoom", "Off"]}
                    value={p.wheelZoom ? "Zoom" : "Off"}
                    onChange={(v) => setPref("wheelZoom", v === "Zoom")}
                  />
                </PrefRow>
                <div className="qzk-pref-note">
                  Drag the plot to box-zoom; double-click to autoscale. Right-click the plot, a
                  dataset, a legend entry, or a worksheet column for context actions.
                </div>
                <PrefRow label="Confirm before removing data">
                  <Switch
                    checked={p.confirmRemove}
                    onChange={(v) => setPref("confirmRemove", v)}
                  />
                </PrefRow>
              </>
            )}
            {tab === "Numbers" && (
              <>
                <PrefRow label="Significant figures">
                  <div style={{ width: 160 }}>
                    <SliderRow
                      label="sf"
                      value={p.sigFigs}
                      min={2}
                      max={8}
                      step={1}
                      onChange={(v) => setPref("sigFigs", v)}
                      format={(v) => String(v)}
                    />
                  </div>
                </PrefRow>
                <PrefRow label="Notation">
                  <Select
                    options={NOTATION_OPTS}
                    value={p.notation}
                    onChange={(e) => setPref("notation", e.target.value)}
                  />
                </PrefRow>
                <div className="qzk-pref-note">
                  Inspector and readout values are JetBrains Mono and right-aligned. Units keep
                  their scientific casing (kOe, Å⁻¹, µ_B/f.u.).
                </div>
              </>
            )}
            {tab === "Keyboard" && (
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
            )}
          </div>
        </div>
        <div className="qzk-prefs-foot">
          <span className="qzk-pref-hint">Changes apply immediately and persist on this machine.</span>
          <Button variant="primary" size="sm" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
