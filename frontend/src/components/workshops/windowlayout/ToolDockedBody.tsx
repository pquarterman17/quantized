// A docked analysis tool window's body (WORKSPACE_LAYOUT_PLAN P4): the tool's
// header band, then its scrolling body. Part of the layout host.

import { useLayoutTools } from "../../../store/layoutTools";
import { focusRef } from "../../../store/windowLayoutActions";
import ToolSlot from "./ToolSlot";

/** A docked tool window's body: its header band, then its scrolling body. */
export default function ToolDockedBody({ id }: { id: string }) {
  const tool = useLayoutTools().get(id);
  if (!tool) return null;
  // A click in the tool's own content counts as a click in its window (the frame cannot see it).
  const activate = () => focusRef(`tool:${id}`);
  return (
    <div className="qzk-wl-tool">
      {tool.head && <ToolSlot el={tool.head} className="qzk-win-head qzk-wl-tool-head" onActivate={activate} />}
      <ToolSlot el={tool.body} className="qzk-wl-tool-body" onActivate={activate} />
    </div>
  );
}
