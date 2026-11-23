// An analysis tool's window in the window layout (WORKSPACE_LAYOUT_PLAN P4,
// D7/D8), rendered by ../../overlays/ToolWindow.tsx in windows mode. The tool
// stays where its workshop mounts it (its React state, its store), and this
// component only:
// - registers it (store/layoutTools) with its title, close and two DOM nodes,
//   its header band and its body, which the layout frame adopts wherever the
//   window is docked or floating (re-docking moves the nodes, never remounts
//   the workshop);
// - reports its `busy` prop (a run in progress);
// - gives focus back to whatever opened the tool when it closes;
// - lets Escape close a DOCKED tool, as it closes a floating one (the classic
//   frame's own rule; the layout's gestures never close a window).
// The host side (./ToolWindowsSync, lazy under the layout host) reacts to the
// registry: it opens the `tool:<id>` window where it was (one window per tool),
// closes it when the tool closes, restores a saved pin, pins a following tool
// while it runs, and moves focus to the window's title bar on open. Keeping
// this component to the registry keeps it out of the layout host's chunk.

import { useLayoutEffect, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";

import { useEscapeSurface } from "../../../lib/escapeStack";
import { isLayoutTool } from "../../../lib/windowLayout/toolCatalog";
import { patchLayoutTool, registerLayoutTool } from "../../../store/layoutTools";
import type { ToolWindowProps } from "../../overlays/ToolWindowFrame";

const node = (className: string): HTMLElement | null => {
  if (typeof document === "undefined") return null;
  const el = document.createElement("div");
  el.className = className;
  return el;
};

type Props = ToolWindowProps & { Frame: ComponentType<ToolWindowProps> };

/** In windows mode: an analysis tool's layout window, any other panel's classic frame. */
export default function LayoutToolWindow({ Frame, ...props }: Props) {
  return isLayoutTool(props.id) ? <ToolLayoutWindow {...props} /> : <Frame {...props} />;
}

function ToolLayoutWindow({ id, title, x, y, width = 360, onClose, helpTopic, header, children, busy = false }: ToolWindowProps) {
  const [head] = useState(() => node("qzk-wl-tool-node"));
  const [body] = useState(() => node("qzk-wl-tool-node"));
  const text = typeof title === "string" ? title : id;
  const hasHead = header !== undefined && header !== null && header !== false;
  const opener = useRef<Element | null>(null);

  // Register once per mount; the fields that change are patched below. The host
  // (./ToolWindowsSync) opens, focuses and closes the window from the registry.
  useLayoutEffect(() => {
    if (!body) return;
    opener.current = document.activeElement;
    const unregister = registerLayoutTool({ id, title: text, onClose, helpTopic, width, x, y, head: hasHead ? head : null, body, busy, autoPin: null });
    return () => {
      const lost = body.contains(document.activeElement) || !!head?.contains(document.activeElement) || document.activeElement === document.body;
      unregister();
      const back = opener.current;
      if (lost && back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one registration per mounted tool
  }, [id, body]);

  useLayoutEffect(() => {
    patchLayoutTool(id, { title: text, onClose, helpTopic, width, x, y, head: hasHead ? head : null, busy });
  }, [id, text, onClose, helpTopic, width, x, y, hasHead, head, busy]);

  useEscapeSurface(
    "window",
    (e) => {
      if (!(e.target instanceof Element) || !e.target.closest(`[data-wl-window="${CSS.escape(`tool:${id}`)}"]`)) return false;
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
