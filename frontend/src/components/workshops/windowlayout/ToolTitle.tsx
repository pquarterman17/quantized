// An analysis tool window's title-bar pin (WORKSPACE_LAYOUT_PLAN P4, D8): the
// tool follows the focused plot; the pin keeps a pinnable tool's input on one
// dataset (store/layoutToolActions), a run pins it automatically, and a tool
// that reads the plot directly says why it cannot be pinned. Lazy.

import { pinOf } from "../../../lib/windowLayout/pins";
import { toolRef } from "../../../lib/windowLayout/refs";
import { pinRefusal } from "../../../lib/windowLayout/toolCatalog";
import { useLayoutTools } from "../../../store/layoutTools";
import { pinTool, unpinTool } from "../../../store/layoutToolActions";
import { useApp } from "../../../store/useApp";
import { announce } from "./layoutAnnounce";

/** The tool's pin, with what it follows. Pressed = pinned. */
export default function ToolTitle({ id }: { id: string }) {
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
