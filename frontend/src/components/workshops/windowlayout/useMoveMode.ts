// Keyboard move mode (WORKSPACE_LAYOUT_PLAN D13): Alt+Shift+M on a focused
// window (or, with focus elsewhere, the focused plot window). While it lasts,
// arrows move a floating window (Shift: 1 px), L / R / B / C dock it left,
// right, bottom or centre, F floats it, Enter commits and Escape cancels and
// restores everything the mode changed. Alt+Shift+M again also commits.
// Alt+Shift+M is free in the app's shortcut map (no other Alt+Shift binding
// exists); like F6 it is claimed only while windows mode is on, and, as every
// app shortcut, never under a modal dialog (lib/appShortcuts).

import { useEffect, useRef, useState } from "react";

import { listenForAppShortcuts, isModalOpen } from "../../../lib/appShortcuts";
import { pushEscapeSurface } from "../../../lib/escapeStack";
import type { WindowLayoutV1, WindowRef } from "../../../lib/windowLayout/types";
import { dockRef, floatRef } from "../../../store/windowLayoutActions";
import { moveTarget, nudge, placementNow, restoreSnapshot, takeSnapshot, type MoveSnapshot } from "../../../store/windowLayoutMoves";
import { PLOT_LIMITS } from "./plotLimits";
import { announce, holdAnnouncement } from "./layoutAnnounce";
import { focusTitleBar, stopOf } from "./useLayoutKeyboard";
import { moveAction } from "./moveKeys";

export interface MoveState {
  ref: WindowRef;
  title: string;
}

export function useMoveMode(layout: WindowLayoutV1 | null, titleOf: (ref: WindowRef) => string): MoveState | null {
  const [mode, setMode] = useState<MoveState | null>(null);
  const snap = useRef<MoveSnapshot | null>(null);
  // Escape cancels without Enter's re-dock/float churn; focus would otherwise fall to <body>.
  const refocus = useRef<WindowRef | null>(null);
  const live = useRef({ layout, titleOf, mode });
  useEffect(() => {
    live.current = { layout, titleOf, mode };
  });

  const exit = (message: string) => {
    snap.current = null;
    setMode(null);
    announce(message);
  };

  useEffect(
    () =>
      listenForAppShortcuts((e) => {
        if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey || e.code !== "KeyM") return;
        e.preventDefault();
        const { layout: l, titleOf: t, mode: m } = live.current;
        if (m) return exit(`Move mode off, ${m.title} placed`);
        const stop = stopOf(document.activeElement);
        // Focus in the Library: it is not a window, so say how to move one instead of moving another.
        if (stop === "library") return announce("The Library does not move. Press F6 to focus a window, then Alt+Shift+M to move it");
        const ref = l ? moveTarget(l, stop) : null;
        if (!ref) return announce("Focus a window first, then press Alt+Shift+M to move it");
        snap.current = takeSnapshot(ref);
        setMode({ ref, title: t(ref) });
        announce(`Move mode on for ${t(ref)}. Arrows move, L R B C dock, F floats, Enter keeps, Escape cancels`);
      }),
    [],
  );

  useEffect(() => {
    if (!mode) return;
    const { ref, title } = mode;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (isModalOpen() || t?.closest("input, textarea, select, [contenteditable='true']")) return;
      const action = moveAction(e);
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      const placement = placementNow(ref);
      // Closed (or pruned) while the mode was on: a dock key would reopen it. Fail closed.
      if (!placement?.open) return exit(`Move mode off, ${title} is closed`);
      if (action.type === "commit") return exit(`Move mode off, ${title} placed`);
      if (action.type === "move") return announce(placement?.slot ? `${title} is docked; press F to float it before moving` : nudge(ref, title, action.dx, action.dy, document.querySelector(`[data-tool-window="${CSS.escape(ref)}"]`)?.getBoundingClientRect(), PLOT_LIMITS));
      if (action.type === "float") return placement?.slot === null ? announce(`${title} is already floating`) : floatRef(ref);
      if (placement?.slot === action.slot) return announce(`${title} is already docked ${action.slot}`);
      dockRef(ref, action.slot);
    };
    window.addEventListener("keydown", onKey, true);
    const off = pushEscapeSurface("gesture", () => {
      const message = `Move mode cancelled, ${title} stays where it was`;
      // A restore that changes the layout would be announced as a dock/float; say the cancel instead.
      if (snap.current && restoreSnapshot(ref, snap.current)) holdAnnouncement(message);
      else announce(message);
      snap.current = null;
      refocus.current = ref;
      setMode(null);
      return true;
    });
    return () => {
      window.removeEventListener("keydown", onKey, true);
      off();
    };
  }, [mode]);

  // After the cancel's own render (the restore may have remounted the window), back to its title bar.
  useEffect(() => {
    if (mode || !refocus.current) return;
    focusTitleBar(refocus.current);
    refocus.current = null;
  }, [mode]);

  // A dock button or a re-dock remounts the window: put focus back on its title bar.
  const slot = mode && layout ? (layout.placements[mode.ref]?.slot ?? "float") : null;
  useEffect(() => {
    if (mode) focusTitleBar(mode.ref);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot]);

  return mode;
}
