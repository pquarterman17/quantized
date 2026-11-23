// The layout chrome of an analysis tool window (WORKSPACE_LAYOUT_PLAN P4):
// the slot that adopts the tool's own DOM nodes (LayoutToolWindow), its docked
// body, its title-bar pin, and its floating frame (the classic ToolWindowFrame,
// so moving, resizing, collapsing and the help button keep one implementation).

import { useLayoutEffect, useRef } from "react";

import { lazyRegion } from "../../../lib/lazyRegion";
import { pinOf } from "../../../lib/windowLayout/pins";
import { toolRef } from "../../../lib/windowLayout/refs";
import { pinRefusal } from "../../../lib/windowLayout/toolCatalog";
import type { WindowRef } from "../../../lib/windowLayout/types";
import { useLayoutTools } from "../../../store/layoutTools";
import { pinTool, unpinTool } from "../../../store/layoutToolActions";
import { useApp } from "../../../store/useApp";
import { closeFromChrome } from "./chromeActions";
import DockButtons from "./DockButtons";
import { announce } from "./layoutAnnounce";

const ToolWindowFrame = lazyRegion(() => import("../../overlays/ToolWindowFrame"), "Window");

/** Adopt a tool's DOM node (move it here; it goes back to its owner on unmount). */
function Slot({ el, className }: { el: HTMLElement; className: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    box.appendChild(el);
    return () => {
      if (el.parentNode === box) box.removeChild(el);
    };
  }, [el]);
  return <div ref={ref} className={className} />;
}

/** A docked tool window's body: its header band, then its scrolling body. */
export function ToolDockedBody({ id }: { id: string }) {
  const tool = useLayoutTools().get(id);
  if (!tool) return null;
  return (
    <div className="qzk-wl-tool">
      {tool.head && <Slot el={tool.head} className="qzk-win-head qzk-wl-tool-head" />}
      <Slot el={tool.body} className="qzk-wl-tool-body" />
    </div>
  );
}

/** The tool's pin, with what it follows. Pressed = pinned. */
export function ToolTitle({ id }: { id: string }) {
  const tool = useLayoutTools().get(id);
  const ref = toolRef(id);
  const pinned = useApp((s) => pinOf(s.windowLayout, ref));
  const shown = pinned ?? tool?.autoPin ?? null;
  const name = useApp((s) => (shown ? (s.datasets.find((d) => d.id === shown)?.name ?? "a removed dataset") : null));
  if (!tool) return null;
  const refusal = pinRefusal(id, tool.title);
  const mode = pinned ? `pinned to ${name}` : tool.autoPin ? `pinned to ${name} while it runs` : "following the plot";
  const press = () => announce(pinned ? unpinTool(id) : pinTool(id));
  return (
    <>
      {shown && (
        <span className="qzk-wl-data-src" data-testid={`tool-pin-${id}`}>
          <span className="qzk-wl-data-mode">· {mode}</span>
        </span>
      )}
      <button
        type="button"
        className="qzk-wl-close qzk-wl-pin"
        aria-label={`Pin ${tool.title} (${mode})`}
        aria-pressed={shown !== null}
        aria-disabled={refusal ? true : undefined}
        title={refusal ?? (pinned ? "Pinned to this dataset; press to follow the focused plot again." : "Following the focused plot; press to keep this tool on its current dataset.")}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={press}
      >
        ⚲
      </button>
    </>
  );
}

/** A floating tool window: the classic frame at the tool's own rect, with the
 *  pin, the dock buttons and the tool's own close. */
export function FloatingTool({ refId, title, deskTop }: { refId: WindowRef; title: string; deskTop: number }) {
  const id = refId.slice(5);
  const tool = useLayoutTools().get(id);
  if (!tool) return null;
  const close = () => closeFromChrome(refId);
  return (
    <ToolWindowFrame
      id={id}
      title={title}
      x={tool.x}
      y={Math.max(tool.y ?? deskTop + 8, deskTop + 8)}
      width={tool.width}
      helpTopic={tool.helpTopic}
      onClose={close}
      header={tool.head ? <Slot el={tool.head} className="qzk-wl-tool-head" /> : undefined}
      titleExtra={
        <>
          <ToolTitle id={id} />
          <DockButtons refId={refId} slot={null} title={title} />
        </>
      }
    >
      <Slot el={tool.body} className="qzk-wl-tool-float" />
    </ToolWindowFrame>
  );
}
