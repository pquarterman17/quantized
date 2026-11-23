// A floating analysis tool window (WORKSPACE_LAYOUT_PLAN P4): the classic
// ToolWindowFrame at the tool's own rect (the one classic mode uses), so moving,
// resizing, collapsing and the help button keep one implementation, with the
// pin, the dock buttons and the tool's own close.

import { lazyRegion } from "../../../lib/lazyRegion";
import type { WindowRef } from "../../../lib/windowLayout/types";
import { PLOT_BAR_CLEAR } from "../../../lib/windowLayout/visibility";
import { useLayoutTools } from "../../../store/layoutTools";
import { focusRef } from "../../../store/windowLayoutActions";
import { closeFromChrome } from "./chromeActions";
import DockButtons from "./DockButtons";
import ToolSlot from "./ToolSlot";
import ToolTitle from "./ToolTitle";

// The classic frame, through the same lazy chunk FloatLayer loads for Style and Data.
const ToolWindow = lazyRegion(() => import("../../overlays/ToolWindow"), "Window");

/** A floating tool window: the classic frame at the tool's own rect, with the
 *  pin, the dock buttons and the tool's own close. */
export default function FloatingTool({ refId, title, deskTop }: { refId: WindowRef; title: string; deskTop: number }) {
  const id = refId.slice(5);
  const tool = useLayoutTools().get(id);
  if (!tool) return null;
  const close = () => closeFromChrome(refId);
  // A click in the tool's own content brings its frame forward, as a click on the frame does.
  const raise = (box: HTMLElement) => {
    box.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    focusRef(refId);
  };
  return (
    <ToolWindow
      classic
      id={id}
      title={title}
      x={tool.x}
      y={Math.max(tool.y ?? 0, deskTop + PLOT_BAR_CLEAR)}
      width={tool.width}
      helpTopic={tool.helpTopic}
      onClose={close}
      keepOnEscape
      header={tool.head ? <ToolSlot el={tool.head} className="qzk-wl-tool-head" onActivate={raise} /> : undefined}
      titleExtra={
        <>
          <ToolTitle id={id} />
          <DockButtons refId={refId} slot={null} title={title} />
        </>
      }
    >
      <ToolSlot el={tool.body} className="qzk-wl-tool-float" onActivate={raise} />
    </ToolWindow>
  );
}
