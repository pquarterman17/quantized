// Tabbed Preferences modal (design interaction layer, ⌘,). Driven by the store
// `prefsOpen` flag; every control calls the generic store `setPref`, which applies
// live (theme/accent/density/reduce-motion to <html>, sig-figs/notation to the
// number formatter) and persists to localStorage. Coexists with the Appearance
// menu — both write the same store. The Keyboard tab reuses lib/shortcuts so the
// reference can't drift from the ? sheet.

import { useEffect, useId, useRef, useState } from "react";

import { isMacPlatform, shortcutGroupsFor } from "../../lib/shortcuts";
import { SegmentedControl } from "../primitives/SegmentedControl";
import { SliderRow } from "../primitives/SliderRow";
import { Switch } from "../primitives/Switch";
import { Button, Select } from "../primitives";
import {
  ACCENT_SWATCHES as ACCENTS,
  loadInteractionPrefs,
  loadPlotPerfPrefs,
  saveInteractionPrefs,
  savePlotPerfPrefs,
} from "../../store/prefs";
import { useApp } from "../../store/useApp";
import { focusablesIn, useDialogFocus } from "./useDialogFocus";
import { useEscapeSurface } from "../../lib/escapeStack";
import { onTabListKeyDown } from "../../lib/tabListKeys";

const IS_MAC = isMacPlatform();

const TABS = ["Appearance", "Plot", "Interaction", "Numbers", "Keyboard"] as const;
type Tab = (typeof TABS)[number];

const TRACE_OPTS = ["Line", "Line + markers", "Scatter", "Step"].map((v) => ({ value: v, label: v }));
const NOTATION_OPTS = [
  { value: "auto", label: "Auto" },
  { value: "scientific", label: "Scientific" },
  { value: "fixed", label: "Fixed" },
];

/** Where focus lands when Preferences opens: the first focusable control in
 *  the active pane — except that when that control is one option of a
 *  `role="tablist"` group, the SELECTED option is taken instead.
 *
 *  Round 8 (review NIT 3). `SegmentedControl` renders every option as a plain
 *  focusable `<button role="tab">` with no roving `tabindex`, so "first
 *  focusable in DOM order" is always the FIRST option, never the current one.
 *  On the Appearance pane that is the Theme control, whose first option is
 *  "Dark": measured with `theme: "light"` active, the landing spot was the
 *  "Dark" button carrying `aria-selected="false"`. A screen-reader user
 *  opening Preferences was told "Dark, tab, not selected" as their entry
 *  point, and Enter/Space there flipped the theme — the opposite of what
 *  landing on "the setting they came for" was meant to buy. The shipped test
 *  only covered the default dark theme, where first-in-DOM and selected
 *  coincide, so the light case was unpinned; both are pinned now.
 *
 *  Only the group the landing control actually belongs to is consulted, and
 *  only when its selected option is itself focusable — otherwise this returns
 *  the plain DOM-order default, which is what every non-tablist pane wants. */
function landingSpotIn(pane: HTMLElement | null): HTMLElement | null {
  const focusables = focusablesIn(pane);
  const first = focusables[0] ?? null;
  if (!first) return null;
  const group = first.closest('[role="tablist"]');
  if (!group) return first;
  const selected = group.querySelector<HTMLElement>('[aria-selected="true"]');
  return selected && focusables.includes(selected) ? selected : first;
}

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
  // GUI_INTERACTION #9: store-independent, like PlotToolbar's showGroupLabels
  // (useApp.ts has zero ratchet headroom) — see store/prefs.ts's header.
  const [persistentTool, setPersistentTool] = useState(() => loadInteractionPrefs().persistentTool);
  // P0.4: same store-independent pattern — see store/prefs.ts's PlotPerfPrefs.
  const [decimateDensePlots, setDecimateDensePlots] = useState(
    () => loadPlotPerfPrefs().decimateDensePlots,
  );
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  // Esc closes even when focus isn't inside the dialog. R1 (P3.3): a `modal`
  // surface in `lib/escapeStack.ts` — a true backdrop modal outranks every
  // other registry surface, and the registry is what orders two of these
  // against EACH OTHER, which window-capture could not.
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

  // R1: focus-in, Tab trap, restore-to-opener, PLUS a deliberate landing spot.
  // The shared hook's raw default (first focusable in DOM order) is the "✕"
  // close button, which says nothing about what this dialog is for, so this
  // effect focuses the meaningful control INSIDE THE ACTIVE PANE at its
  // CURRENT value (`landingSpotIn`, round 8 NIT 3). It runs BEFORE
  // `useDialogFocus` so that hook's default sees focus already inside and
  // skips (the rule ParamDialog's `autoFocus` relies on). The Keyboard pane
  // has no focusable content, so there this is a no-op and the hook falls
  // back to the close button — correct for that one pane.
  useEffect(() => {
    if (!open) return;
    landingSpotIn(paneRef.current)?.focus();
  }, [open]);
  useDialogFocus(dialogRef, open);

  if (!open) return null;
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

  return (
    <div className="qz-overlay-backdrop qzk-prefs-overlay" onMouseDown={() => setOpen(false)}>
      <div
        className="qzk-prefs"
        role="dialog"
        aria-labelledby={titleId}
        ref={dialogRef}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="qzk-prefs-head">
          <span className="ttl" id={titleId}>Preferences</span>
          <button aria-label="Close" className="qzk-prefs-x" title="Close (Esc)" onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>
        <div className="qzk-prefs-body">
          {/* Vertical tablist, AUTOMATIC activation (lib/tabListKeys): a pane is
              local state rendered synchronously, so selecting on focus is free. */}
          <div
            className="qzk-prefs-nav"
            role="tablist"
            aria-label="Preferences sections"
            aria-orientation="vertical"
            onKeyDown={(e) => onTabListKeyDown(e, true)}
          >
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                id={`${titleId}${t}`}
                aria-selected={tab === t}
                aria-controls={`${titleId}pane`}
                tabIndex={tab === t ? 0 : -1}
                className={`qzk-prefs-tab${tab === t ? " active" : ""}`}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <div
            className="qzk-prefs-pane"
            ref={paneRef}
            role="tabpanel"
            id={`${titleId}pane`}
            aria-labelledby={`${titleId}${tab}`}
            tabIndex={tab === "Keyboard" ? 0 : undefined}
          >
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
                  <Switch aria-label="Reduce motion" checked={p.reduceMotion} onChange={(v) => setPref("reduceMotion", v)} />
                </PrefRow>
              </>
            )}
            {tab === "Plot" && (
              <>
                <PrefRow label="Default trace">
                  <Select
                    aria-label="Default trace"
                    options={TRACE_OPTS}
                    value={p.defaultTrace}
                    onChange={(e) => setPref("defaultTrace", e.target.value)}
                  />
                </PrefRow>
                <PrefRow label="Default line width">
                  <div style={{ width: 160 }}>
                    <SliderRow
                      aria-label="Line width"
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
                  <Switch aria-label="Grid lines" checked={p.defaultGrid} onChange={(v) => setPref("defaultGrid", v)} />
                </PrefRow>
                <PrefRow label="Multi-panel fit" hint="fresh Origin multi-panel figures">
                  <SegmentedControl
                    options={["Aspect", "Fill"]}
                    value={p.defaultPanelFit === "window" ? "Fill" : "Aspect"}
                    onChange={(v) => setPref("defaultPanelFit", v === "Fill" ? "window" : "frames")}
                  />
                </PrefRow>
                <PrefRow label="Excluded rows" hint="filtered / excluded points on the plot">
                  <SegmentedControl
                    options={["Hide", "Grey"]}
                    value={p.excludedDisplay === "grey" ? "Grey" : "Hide"}
                    onChange={(v) => setPref("excludedDisplay", v === "Grey" ? "grey" : "hide")}
                  />
                </PrefRow>
                <PrefRow label="Copy figure background" hint="transparent pastes onto coloured slides; opaque is safer for Word/print">
                  <SegmentedControl
                    options={["Opaque", "Transparent"]}
                    value={p.copyFigureTransparent ? "Transparent" : "Opaque"}
                    onChange={(v) => setPref("copyFigureTransparent", v === "Transparent")}
                  />
                </PrefRow>
                <PrefRow label="Antialias 2-D map" hint="smooth vs crisp heatmap cells">
                  <Switch aria-label="Antialias map" checked={p.antialias} onChange={(v) => setPref("antialias", v)} />
                </PrefRow>
                <PrefRow
                  label="High-density plot decimation"
                  hint="above ~10k rows, draw a min/max-reduced view that re-resolves on zoom"
                >
                  <Switch
                    aria-label="Plot decimation"
                    checked={decimateDensePlots}
                    onChange={(v) => {
                      setDecimateDensePlots(v);
                      savePlotPerfPrefs({ decimateDensePlots: v });
                    }}
                  />
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
                <PrefRow
                  label="Origin book click opens"
                  hint="clicking an imported Origin workbook in the Library"
                >
                  <SegmentedControl
                    options={["Worksheet", "Plot"]}
                    value={p.originBookClickOpens === "plot" ? "Plot" : "Worksheet"}
                    onChange={(v) =>
                      setPref("originBookClickOpens", v === "Plot" ? "plot" : "worksheet")
                    }
                  />
                </PrefRow>
                <PrefRow label="Confirm before removing data">
                  <Switch
                    aria-label="Confirm removal"
                    checked={p.confirmRemove}
                    onChange={(v) => setPref("confirmRemove", v)}
                  />
                </PrefRow>
                <PrefRow
                  label="Persistent plot tool"
                  hint="Esc cancels a drag but keeps the tool armed, instead of returning to Pointer"
                >
                  <Switch
                    aria-label="Persistent tool"
                    checked={persistentTool}
                    onChange={(v) => {
                      setPersistentTool(v);
                      saveInteractionPrefs({ persistentTool: v });
                    }}
                  />
                </PrefRow>
              </>
            )}
            {tab === "Numbers" && (
              <>
                <PrefRow label="Significant figures">
                  <div style={{ width: 160 }}>
                    <SliderRow
                      aria-label="Significant figures"
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
                    aria-label="Notation"
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
