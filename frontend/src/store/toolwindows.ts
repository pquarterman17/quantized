// The floating workshop `ToolWindow` position/size/collapsed registry
// (GUI_INTERACTION_PLAN #10 — "floating workshops recoverable"), extracted
// as its own slice from day one — store-size ratchet headroom is scarce
// (architecture.test.ts's STORE_PINS), and this is a self-contained,
// cohesive piece of state exactly like store/panels.ts or store/shapes.ts.
//
// Before #10, `ToolWindow` owned its geometry in local `useState` (see the
// old header comment it carried, still true of `components/windows/
// PlotWindowFrame`'s doc referencing it) — every close/reopen reset a
// window to its default props. Lifting it here is what lets (a) a window
// survive close/reopen, (b) "Reset window positions" (commands/
// uiCommands.ts) reach every open-or-ever-opened window from one place, and
// (c) the layout round-trip through the `.dwk` workspace (lib/workspace.ts).
// Composed into the ONE useApp store instance exactly like store/panels.ts
// (read store/windows.ts's header first for the general slice pattern).

import { type ToolWindowLayout } from "../lib/toolwindow";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;

export interface ToolWindowsSlice {
  /** Every ToolWindow's persisted geometry, keyed by its `id` prop (e.g.
   *  "baseline", "curvefit", "report") — an absent key means the component's
   *  own default `x`/`y`/`width` props (never moved/resized/collapsed yet).
   *  Survives close/reopen and round-trips through the `.dwk` workspace. */
  toolWindowLayout: Record<string, ToolWindowLayout>;
  /** Merge-write one window's full layout — drag/resize/collapse and the
   *  viewport-resize re-clamp all funnel through this one setter.
   *  `ToolWindow` itself computes the clamped/patched value before calling
   *  in, so this slice stays a plain registry with no geometry math. */
  setToolWindowLayout: (id: string, layout: ToolWindowLayout) => void;
  /** Double-click-the-title-bar / chevron-button toggle. `fallback` is the
   *  caller's own default layout (used when `id` has no entry yet — the
   *  first-ever interaction with a window that was never dragged). */
  toggleToolWindowCollapsed: (id: string, fallback: ToolWindowLayout) => void;
  /** View-menu "Reset window positions" (commands/uiCommands.ts): drops
   *  every persisted entry, so every open (and future) ToolWindow falls back
   *  to its own default x/y/width props, uncollapsed, auto-height. */
  resetToolWindowPositions: () => void;
}

export function createToolWindowsSlice(set: SliceSet): ToolWindowsSlice {
  return {
    toolWindowLayout: {},
    setToolWindowLayout: (id, layout) =>
      set((s) => ({ toolWindowLayout: { ...s.toolWindowLayout, [id]: layout } })),
    toggleToolWindowCollapsed: (id, fallback) =>
      set((s) => {
        const current = s.toolWindowLayout[id] ?? fallback;
        return {
          toolWindowLayout: { ...s.toolWindowLayout, [id]: { ...current, collapsed: !current.collapsed } },
        };
      }),
    resetToolWindowPositions: () => set({ toolWindowLayout: {} }),
  };
}
