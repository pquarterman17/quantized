// A docked analysis tool window's body (WORKSPACE_LAYOUT_PLAN P4): the tool's
// header band, then its scrolling body. Lazy (the layout host's tool chrome).

import { useLayoutTools } from "../../../store/layoutTools";
import ToolSlot from "./ToolSlot";

/** A docked tool window's body: its header band, then its scrolling body. */
export default function ToolDockedBody({ id }: { id: string }) {
  const tool = useLayoutTools().get(id);
  if (!tool) return null;
  return (
    <div className="qzk-wl-tool">
      {tool.head && <ToolSlot el={tool.head} className="qzk-win-head qzk-wl-tool-head" />}
      <ToolSlot el={tool.body} className="qzk-wl-tool-body" />
    </div>
  );
}
