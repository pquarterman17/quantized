// The right-hand title-bar buttons of a ToolWindow (split out of ToolWindow.tsx
// for the component ceiling): contextual help, Dock / Float (UX-F, dock-capable
// windows only) and Collapse. The title bar IS the drag handle, so every button
// stops pointerdown reaching it, or pressing one would pick the window up.

import type { PointerEvent } from "react";

import { openHelpTopic } from "../../store/help";

const stop = (e: PointerEvent) => e.stopPropagation();

export default function ToolWindowTitleButtons({
  panelName,
  topic,
  dockable,
  docked,
  collapsed,
  onDock,
  onFloat,
  onCollapseToggle,
}: {
  panelName: string;
  topic: string | undefined;
  dockable: boolean;
  docked: boolean;
  collapsed: boolean;
  onDock: () => void;
  onFloat: () => void;
  onCollapseToggle: () => void;
}) {
  return (
    <>
      {topic && (
        <button
          type="button"
          className="qz-card-help"
          aria-label={`Help for ${panelName}`}
          data-tip="Open related help"
          data-tip-desc="Show Help already filtered to this panel's related tools."
          onPointerDown={stop}
          onClick={(e) => {
            e.stopPropagation();
            openHelpTopic(topic);
          }}
        >
          {/* Decorative: the accessible name comes from aria-label above. */}
          <span aria-hidden="true">?</span>
        </button>
      )}
      {dockable && (
        <button
          type="button"
          className="qzk-win-dock"
          aria-label={docked ? `Float ${panelName}` : `Dock ${panelName} in the side panel`}
          data-tip={docked ? "Float over the plot" : "Dock in the side panel"}
          data-tip-desc={
            docked
              ? "Undock this panel into a movable window; the Inspector comes back. Dragging the title bar does the same."
              : "Put this panel in the side column, in place of the Inspector, so it never covers the plot."
          }
          onPointerDown={stop}
          onClick={docked ? onFloat : onDock}
        >
          <span aria-hidden="true">{docked ? "⧉" : "⇥"}</span>
        </button>
      )}
      {!docked && (
        <button
          aria-label={collapsed ? "Expand" : "Collapse"}
          className="qzk-win-collapse"
          title={collapsed ? "Expand" : "Collapse"}
          onPointerDown={stop}
          onClick={onCollapseToggle}
        >
          {collapsed ? "▸" : "▾"}
        </button>
      )}
    </>
  );
}
