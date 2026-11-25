// Tabbed Preferences modal (design interaction layer, ⌘,). Driven by the store
// `prefsOpen` flag. A SHELL: the tabs, their panes, search keywords and reset
// specs live in the registry `./prefsTabs.tsx` (a later lane appends a tab
// there, never here); the footer with Reset tab / Reset all is
// `./PrefsResetBar.tsx`; in-pane search filtering is `./usePrefsSearch.ts`.
// Every control applies live and persists through lib/prefSlots.ts
// (localStorage + the server prefs file).

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { readPrefSlot, writePrefSlot } from "../../lib/prefSlots";
import { useApp } from "../../store/useApp";
import { PREFS_TABS, normQuery, tabMatches } from "./prefsTabs";
import PrefsResetBar from "./PrefsResetBar";
import { focusablesIn, useDialogFocus } from "./useDialogFocus";
import { usePrefsSearch } from "./usePrefsSearch";
import { useEscapeSurface } from "../../lib/escapeStack";
import { onTabListKeyDown } from "../../lib/tabListKeys";

/** The dialog's last tab (P2-15): browser-local UI memory, not a synced pref. */
export const PREFS_DIALOG_KEY = "qz.prefsDialog";
const lastTab = (): string => {
  const t = readPrefSlot(PREFS_DIALOG_KEY)?.tab;
  return PREFS_TABS.some((d) => d.id === t) ? (t as string) : PREFS_TABS[0].id;
};

/** Where focus lands when Preferences opens: the active pane's first Tab
 *  stop. `SegmentedControl` is a radio group with a roving tab stop on the
 *  CHECKED option, and `focusablesIn` skips `tabindex="-1"`, so for a
 *  segmented control that first stop is already its current value — never an
 *  unselected option a stray Enter/Space would apply (round 8 NIT 3). */
function landingSpotIn(pane: HTMLElement | null): HTMLElement | null {
  return focusablesIn(pane)[0] ?? null;
}

export default function PreferencesDialog() {
  const open = useApp((s) => s.prefsOpen);
  const setOpen = useApp((s) => s.setPrefsOpen);
  const [tab, setTabState] = useState(lastTab);
  const [query, setQuery] = useState("");
  // Bumped by a reset: remounts the pane so local copies re-read their values.
  const [resetNonce, setResetNonce] = useState(0);
  const setTab = (t: string) => {
    setTabState(t);
    writePrefSlot(PREFS_DIALOG_KEY, { tab: t });
  };
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [pane, setPane] = useState<HTMLDivElement | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const paneCb = useCallback((el: HTMLDivElement | null) => {
    paneRef.current = el;
    setPane(el);
  }, []);
  const titleId = useId();
  const q = normQuery(query);
  const visible = PREFS_TABS.filter((t) => tabMatches(t, q));
  const active = visible.find((t) => t.id === tab) ?? visible[0];
  usePrefsSearch(pane, q, active ? normQuery(active.id).includes(q) : true, `${active?.id}:${resetNonce}`);

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
              local state rendered synchronously, so selecting on focus is free.
              While searching it lists only the tabs that match. */}
          <div className="qzk-prefs-side">
          <input
            type="search"
            className="qzk-prefs-search"
            aria-label="Search preferences"
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div
            className="qzk-prefs-nav"
            role="tablist"
            aria-label="Preferences sections"
            aria-orientation="vertical"
            onKeyDown={(e) => onTabListKeyDown(e, true)}
          >
            {visible.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`${titleId}${t.id}`}
                aria-selected={active === t}
                aria-controls={`${titleId}pane`}
                tabIndex={active === t ? 0 : -1}
                className={`qzk-prefs-tab${active === t ? " active" : ""}`}
                onClick={() => setTab(t.id)}
              >
                {t.id}
              </button>
            ))}
          </div>
          </div>
          <div
            className="qzk-prefs-pane"
            ref={paneCb}
            role="tabpanel"
            id={`${titleId}pane`}
            aria-labelledby={active ? `${titleId}${active.id}` : undefined}
            tabIndex={active?.focusPane ? 0 : undefined}
          >
            {active ? (
              <active.Pane key={`${active.id}:${resetNonce}`} />
            ) : (
              <div className="qzk-pref-note">No preferences match “{query.trim()}”.</div>
            )}
          </div>
        </div>
        <PrefsResetBar tab={active} onDone={() => setOpen(false)} onReset={() => setResetNonce((n) => n + 1)} />
      </div>
    </div>
  );
}
