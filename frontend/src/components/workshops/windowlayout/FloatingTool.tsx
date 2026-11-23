// A floating analysis tool window (WORKSPACE_LAYOUT_PLAN P4): the classic
// ToolWindowFrame at the tool's own rect (the one classic mode uses), so moving,
// resizing, collapsing and the help button keep one implementation, with the
// pin, the dock buttons and the tool's own close. Lazy.

import { lazyRegion } from "../../../lib/lazyRegion";
import type { WindowRef } from "../../../lib/windowLayout/types";
import { useLayoutTools } from "../../../store/layoutTools";
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
  return (
    <ToolWindow
      classic
      id={id}
      title={title}
      x={tool.x}
      y={Math.max(tool.y ?? deskTop + 8, deskTop + 8)}
      width={tool.width}
      helpTopic={tool.helpTopic}
      onClose={close}
      header={tool.head ? <ToolSlot el={tool.head} className="qzk-wl-tool-head" /> : undefined}
      titleExtra={
        <>
          <ToolTitle id={id} />
          <DockButtons refId={refId} slot={null} title={title} />
        </>
      }
    >
      <ToolSlot el={tool.body} className="qzk-wl-tool-float" />
    </ToolWindow>
  );
}
