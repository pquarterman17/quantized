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
// - Escape NEVER closes a tool window (UX pass 3 M5; PROVISIONAL, owner to confirm: it dropped the
//   workshop's typed state without a word, and was inconsistent with fields, where Escape only
//   closes a dropdown). From the body it steps back to the window's title bar, from the title bar
//   to the focused plot, and says the tool is still open; the Close button closes it.
// The host side (./ToolWindowsSync, lazy under the layout host) reacts to the
// registry: it opens the `tool:<id>` window where it was (one window per tool),
// closes it when the tool closes, restores a saved pin, pins a following tool
// while it runs, and moves focus to the window's title bar on open. Keeping
// this component to the registry keeps it out of the layout host's chunk.

import { useLayoutEffect, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";

import { useEscapeSurface } from "../../../lib/escapeStack";
import { currentFocusedPlot, focusRef } from "../../../store/windowLayoutActions";
import { announce } from "./layoutAnnounce";
import { focusTitleBar } from "./useLayoutKeyboard";
import { toolRef } from "../../../lib/windowLayout/refs";
import { isLayoutTool } from "../../../lib/windowLayout/toolCatalog";
import { patchLayoutTool, registerLayoutTool, useLayoutHostMounted } from "../../../store/layoutTools";
import type { ToolWindowProps } from "../../overlays/ToolWindowFrame";
import ToolSlot from "./ToolSlot";

const node = (className: string): HTMLElement | null => {
  if (typeof document === "undefined") return null;
  const el = document.createElement("div");
  el.className = className;
  return el;
};

type Props = ToolWindowProps & { Frame: ComponentType<ToolWindowProps> };

/** In windows mode: an analysis tool's layout window, any other panel's classic frame. */
export default function LayoutToolWindow({ Frame, ...props }: Props) {
  return isLayoutTool(props.id) ? <ToolLayoutWindow {...props} Frame={Frame} /> : <Frame {...props} />;
}

/** Raise a classic frame from inside its adopted body (its own onMouseDown raises it). */
const raiseFrame = (box: HTMLElement) => box.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

function ToolLayoutWindow({ id, title, x, y, width = 360, onClose, helpTopic, header, children, busy = false, Frame }: Props) {
  // While a full-workspace view (Quick Figure Builder, Library tiles) replaces the layout host, the
  // tool shows in the classic floating frame, adopting the SAME nodes: nothing remounts, and the
  // registry entry (and a run's pin) stays as it was for when the host comes back.
  const hosted = useLayoutHostMounted();
  const [head] = useState(() => node("qzk-wl-tool-node"));
  const [body] = useState(() => node("qzk-wl-tool-node"));
  const text = typeof title === "string" ? title : id;
  const hasHead = header !== undefined && header !== null && header !== false;
  const opener = useRef<Element | null>(null);
  // The registry keeps one stable close that calls the latest prop: many workshops pass a new
  // function each render, and re-publishing the registry would re-render the whole layout.
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  });
  const [close] = useState(() => () => closeRef.current?.());
  const hasClose = onClose !== undefined;

  // Register once per mount; the fields that change are patched below. The host
  // (./ToolWindowsSync) opens, focuses and closes the window from the registry.
  useLayoutEffect(() => {
    if (!body) return;
    opener.current = document.activeElement;
    const unregister = registerLayoutTool({ id, title: text, onClose: hasClose ? close : undefined, helpTopic, width, x, y, head: hasHead ? head : null, body, busy, autoPin: null, pinRestored: false });
    return () => {
      // Focus in the tool, on its window's own chrome (its ✕), or already lost: give it back to the opener.
      const at = document.activeElement;
      const frame = at?.closest(`[data-wl-window="${CSS.escape(`tool:${id}`)}"], [data-tool-window="${CSS.escape(id)}"]`);
      const lost = body.contains(at) || !!head?.contains(at) || !!frame || at === document.body;
      unregister();
      const back = opener.current;
      // After React's commit (it puts focus back on the ✕ it is about to remove) and the window's
      // own removal: then, if focus has nowhere better to be, it goes back to the opener.
      if (lost && back instanceof HTMLElement) {
        setTimeout(() => {
          const now = document.activeElement;
          const stranded = !now || now === document.body || !now.isConnected;
          if (stranded && back.isConnected) back.focus({ preventScroll: true });
        }, 0);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one registration per mounted tool
  }, [id, body]);

  useLayoutEffect(() => {
    patchLayoutTool(id, { title: text, onClose: hasClose ? close : undefined, helpTopic, width, x, y, head: hasHead ? head : null, busy });
  }, [id, text, hasClose, close, helpTopic, width, x, y, hasHead, head, busy]);

  useEscapeSurface("window", (e) => {
    const at = e.target;
    if (!(at instanceof Element) || !at.closest(`[data-wl-window="${CSS.escape(`tool:${id}`)}"], [data-tool-window="${CSS.escape(id)}"]`)) return false;
    const ref = toolRef(id);
    if (!at.closest(".qzk-wl-title, .qzk-win-title")) {
      focusTitleBar(ref);
      return true;
    }
    const plot = currentFocusedPlot();
    if (!plot) return false;
    focusRef(plot);
    focusTitleBar(plot);
    announce(`${text} is still open; its Close button closes it.`);
    return true;
  });

  if (!body) return null;
  return (
    <>
      {hasHead && head && createPortal(header, head)}
      {createPortal(children, body)}
      {!hosted && (
        <Frame
          id={id}
          title={title}
          x={x}
          y={y}
          width={width}
          helpTopic={helpTopic}
          onClose={hasClose ? close : undefined}
          header={hasHead && head ? <ToolSlot el={head} className="qzk-wl-tool-head" onActivate={raiseFrame} /> : undefined}
        >
          <ToolSlot el={body} className="qzk-wl-tool-float" onActivate={raiseFrame} />
        </Frame>
      )}
    </>
  );
}
