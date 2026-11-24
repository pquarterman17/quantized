// Menu state on toggles and cycles (UX menus audit N3): "Toggle grid lines",
// "Toggle legend" and "Toggle statistics view" show a check like the plot
// context menu does; the cycle commands show the value they are on NOW in
// their menu label ("Cycle Y axis scale (now log)"), so the menu answers
// "what is it set to" before the click. The palette keeps the static labels
// (`labelFn` is menu-only, store/commands.ts).
//
// One table over the built registry (the commands/menuAvailability.ts pattern),
// so plotCommands.ts / dataCommands.ts / uiCommands.ts, which sit at their line
// ceilings, do not grow. A command that declares its own `checked` / `labelFn`
// keeps it. Lazy-only: appCommands.ts is the one importer. Evaluated when a
// menu opens, never at build time.
//
// Provisional, owner to confirm: the "(now …)" wording, versus radio flyouts of
// the values (the audit's alternative).

import type { StoreGet } from "../lib/exportActive";
import type { Action } from "../store/commands";

type State = ReturnType<StoreGet>;

/** id -> checked state. */
const CHECKED: Readonly<Partial<Record<string, (st: State) => boolean>>> = {
  grid: (st) => st.showGrid,
  legend: (st) => st.showLegend,
  statMode: (st) => st.statMode,
};

/** id -> the menu label with the current value. */
const LABELS: Readonly<Partial<Record<string, (st: State) => string>>> = {
  yLog: (st) => `Cycle Y axis scale (now ${st.yScale})`,
  xLog: (st) => `Cycle X axis scale (now ${st.xScale})`,
  yTickFormat: (st) => `Cycle Y tick format (now ${st.yFmt.mode})`,
  xTickFormat: (st) => `Cycle X tick format (now ${st.xFmt.mode})`,
  "panel-fit": (st) => `Multi-panel fit (now ${st.panelFit})`,
  "recalc-mode": (st) => `Recalc mode (now ${st.recalcMode === "off" ? "none" : st.recalcMode})`,
  density: (st) => `Cycle density (now ${st.density})`,
  accent: (st) => `Cycle accent color (now ${st.accent})`,
};

/** `actions` with the toggles' `checked` and the cycles' menu `labelFn` merged in. */
export function withMenuState(actions: Action[], s: StoreGet): Action[] {
  return actions.map((a) => {
    const checked = CHECKED[a.id];
    const label = LABELS[a.id];
    if (!checked && !label) return a;
    return {
      ...a,
      ...(checked && a.checked === undefined ? { checked: () => checked(s()) } : {}),
      ...(label && !a.labelFn ? { labelFn: () => label(s()) } : {}),
    };
  });
}

/** The ids this table covers, for the test that each names a real command. */
export const MENU_STATE_IDS: readonly string[] = [...Object.keys(CHECKED), ...Object.keys(LABELS)];
