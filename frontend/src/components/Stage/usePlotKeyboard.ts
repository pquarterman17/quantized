// Keyboard access to the 2-D plot canvas (WCAG 2.1.1). The plot host becomes a
// focusable role="application": ArrowLeft/Right walk a data-point cursor along
// the active series in DATA order (so a non-monotonic hysteresis loop goes point
// by point), ArrowUp/Down switch series, +/-/Shift+arrows zoom and pan about the
// cursor, Home / 0 reset. The readout goes out through `onReadout` (the hover
// tool's Readout, drawn by PlotReadouts) and an aria-live region; zoom/pan/reset
// commit through `onViewChange` (store.recordView), the toolbar tools' own path.
// Follows Map3dCanvas's onKeyDown conventions.
//
// This file is the eager shell (host props, key filter, lifecycle); the
// behaviour is the lazy `plotKeyboardCore`, preloaded on focus so the first key
// normally finds it ready. Inert while an input/select/contenteditable has focus,
// for events not on the host itself, and with Ctrl/Meta/Alt held (Alt+arrows are
// the global view back/forward).

import { useCallback, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";

import { isEditingTarget } from "../../lib/editingTarget";
import type { PlotPayload } from "../../lib/plotdata";
import type { PlotViewBounds, Readout } from "../../lib/uplotTools";
import type { KbCtx } from "./plotKeyboardCore";
import type uPlot from "uplot";

export interface PlotKeyboardArgs {
  plotRef: { current: uPlot | null };
  payload: PlotPayload | null;
  hidden?: boolean[];
  onViewChange?: (before: PlotViewBounds, after: PlotViewBounds) => void;
  onReadout?: (r: Readout | null) => void;
  /** Axis names for the accessible name. */
  xLabel?: string | null;
  yLabel?: string | null;
}

const HANDLED = /^(Arrow(Left|Right|Up|Down)|[+=\-_0]|Home)$/;
const load = () => import("./plotKeyboardCore");

export function usePlotKeyboard({ plotRef, payload, hidden, onViewChange, onReadout, xLabel, yLabel }: PlotKeyboardArgs) {
  const [live, setLive] = useState("");
  const ctx = useRef<KbCtx>({ plotRef, payload, setLive, cur: null, pending: null, timer: null });
  Object.assign(ctx.current, { plotRef, payload, hidden, onViewChange, onReadout });

  const clear = useCallback(() => {
    const c = ctx.current;
    c.cur = null;
    c.plotRef.current?.over.querySelector("[data-kb-cursor]")?.remove();
    setLive("");
    c.onReadout?.(null);
  }, []);
  // A new payload invalidates the cursor.
  useEffect(() => { if (ctx.current.cur) clear(); }, [payload, clear]);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget || isEditingTarget(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
    const { key, shiftKey } = e;
    if (!HANDLED.test(key) || !ctx.current.payload) return;
    e.preventDefault(); // also keeps the global ArrowUp/Down dataset stepping out of it
    void load().then((m) => m.handleKey(ctx.current, key, shiftKey), () => {});
  };

  const name = `Plot: ${yLabel || payload?.series.find((s) => !s.muted)?.label || "y"} vs ${xLabel || payload?.xLabel || "x"}`;
  return {
    hostProps: {
      tabIndex: 0,
      role: "application",
      "aria-roledescription": "2-D plot",
      "aria-label": `${name}, arrow keys move the cursor, plus and minus zoom, shift with arrows pans, Home resets`,
      onKeyDown,
      onFocus: (e: FocusEvent<HTMLElement>) => { if (e.target === e.currentTarget) void load().catch(() => {}); },
      onBlur: clear,
      onPointerDown: clear,
    },
    live,
  };
}
