// Active-tool resting feedback (GUI_INTERACTION_PLAN #9): a slim floating
// strip near the plot showing which non-Pointer data tool is armed, its
// one-line gesture hint, and the shortcut/Esc affordance — e.g.
// "∩ Peak / FWHM — drag a range to measure a peak's width · W · Esc
// cancels". Sourced entirely from lib/plotToolbarDefs (name/hint — the SAME
// table PlotToolbar's tooltips read, so the two can't drift) and
// lib/plotToolKeys' keyForTool (the shortcut chip). Hidden for "pointer" —
// the resting/default tool needs no explanation — so this renders nothing
// on a fresh workspace.
//
// Deliberately its own component, not inlined in PlotStage.tsx: that file
// sits at its line-ceiling ratchet pin (see architecture.test.ts's
// component-ceiling guard) with no room for a new floating panel's markup.

import { keyForTool } from "../../lib/plotToolKeys";
import { toolDefFor } from "../../lib/plotToolbarDefs";
import type { PlotTool } from "../../lib/uplotOpts";

interface Props {
  tool: PlotTool;
}

export default function ToolHud({ tool }: Props) {
  if (tool === "pointer") return null;
  const def = toolDefFor(tool);
  if (!def) return null;
  const key = keyForTool(tool);
  return (
    <div className="qzk-glass qzk-tool-hud" role="status">
      <span className="g">{def.glyph}</span>
      <span className="name">{def.name}</span>
      <span className="sep">—</span>
      <span className="hint">{def.hint ?? def.desc}</span>
      {key && <span className="key">{key}</span>}
      <span className="esc">Esc cancels</span>
    </div>
  );
}
