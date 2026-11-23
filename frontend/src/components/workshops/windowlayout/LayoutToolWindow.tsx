// An analysis tool's window in the window layout (WORKSPACE_LAYOUT_PLAN P4,
// D7/D8), rendered by ../../overlays/ToolWindow.tsx in windows mode. The tool
// stays where its workshop mounts it (its React state, its store), and this
// component only:
// - registers it (store/layoutTools) with its title, close and two DOM nodes,
//   its header band and its body, which the layout frame adopts wherever the
//   window is docked or floating (re-docking moves the nodes, never remounts
//   the workshop);
// - opens its `tool:<id>` window where it was (one window per tool: a second
//   open only focuses it) and closes the window when the tool closes, keeping
//   the placement for next time;
// - puts a saved pin's frozen input back, and pins a following tool while it
//   runs (store/layoutToolActions);
// - takes focus on open (the title bar, as the classic frame takes it) and
//   gives it back to whatever opened the tool when it closes;
// - lets Escape close a DOCKED tool, as it closes a floating one (the classic
//   frame's own rule; the layout's gestures never close a window).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { isModalOpen } from "../../../lib/appShortcuts";
import { useEscapeSurface } from "../../../lib/escapeStack";
import { toolRef } from "../../../lib/windowLayout/refs";
import { patchLayoutTool, registerLayoutTool } from "../../../store/layoutTools";
import { closeToolPlacement, openToolPlacement, restoreToolPin, toolBusyChanged } from "../../../store/layoutToolActions";
import type { ToolWindowProps } from "../../overlays/ToolWindowFrame";
import { announce } from "./layoutAnnounce";
import { focusTitleBar } from "./useLayoutKeyboard";

const node = (className: string): HTMLElement | null => {
  if (typeof document === "undefined") return null;
  const el = document.createElement("div");
  el.className = className;
  return el;
};

export default function LayoutToolWindow({ id, title, x, y, width = 360, onClose, helpTopic, header, children, busy = false }: ToolWindowProps) {
  const [head] = useState(() => node("qzk-wl-tool-node"));
  const [body] = useState(() => node("qzk-wl-tool-node"));
  const text = typeof title === "string" ? title : id;
  const hasHead = header !== undefined && header !== null && header !== false;
  const opener = useRef<Element | null>(null);

  // Register once per mount; the fields that change are patched below.
  useLayoutEffect(() => {
    if (!body) return;
    opener.current = document.activeElement;
    const unregister = registerLayoutTool({ id, title: text, onClose, helpTopic, width, x, y, head: hasHead ? head : null, body, busy: false, autoPin: null });
    restoreToolPin(id);
    openToolPlacement(id);
    const frame = requestAnimationFrame(() => {
      if (!isModalOpen()) focusTitleBar(toolRef(id));
    });
    return () => {
      cancelAnimationFrame(frame);
      const lost = body.contains(document.activeElement) || !!head?.contains(document.activeElement) || document.activeElement === document.body;
      unregister();
      closeToolPlacement(id);
      const back = opener.current;
      if (lost && back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one registration per mounted tool
  }, [id, body]);

  useLayoutEffect(() => {
    patchLayoutTool(id, { title: text, onClose, helpTopic, width, x, y, head: hasHead ? head : null });
  }, [id, text, onClose, helpTopic, width, x, y, hasHead, head]);

  useEffect(() => {
    const said = toolBusyChanged(id, busy);
    if (said) announce(said);
  }, [id, busy]);

  useEscapeSurface(
    "window",
    (e) => {
      if (!(e.target instanceof Element) || !e.target.closest(`[data-wl-window="${CSS.escape(toolRef(id))}"]`)) return false;
      onClose?.();
      return true;
    },
    onClose !== undefined,
  );

  if (!body) return null;
  return (
    <>
      {hasHead && head && createPortal(header, head)}
      {createPortal(children, body)}
    </>
  );
}
