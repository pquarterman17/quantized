// What the layout host hands the Analysis window's body (WORKSPACE_LAYOUT_PLAN
// P4). The body is a lazy chunk of its own; everything it needs from the layout
// comes through this object, so the chunk imports no module of the host's (a
// module both import would be split into a shared chunk the entry bundle has to
// name: the bundle budget). Types only.

import type { FollowSource } from "../../../lib/windowLayout/pins";

export interface AnalysisHost {
  /** What the window shows (the focused plot's dataset, or its pin). */
  source: FollowSource;
  /** The Data window has shown the source dataset this session (the Inspect step). */
  inspected: boolean;
  /** Say a sentence in the layout's live region. */
  announce: (text: string) => void;
  /** Open (or bring forward) the Data window on `datasetId`; refused, with the
   *  sentence, when the Data window would show another dataset (its own pin, the
   *  Library selection, or another focused plot). */
  openData: (datasetId: string) => string | null;
  /** Unpin the Analysis window. */
  unpin: () => void;
  /** Bring the window of the tool an Analyze command opens forward when it is
   *  open; returns its tool id, else null. */
  focusOpenTool: (actionId: string) => string | null;
  /** Open the active dataset's map window without taking focus (a map tool, e.g. ROI cuts, reads it). */
  openMap: () => Promise<void>;
  /** Move keyboard focus to a tool window's title bar. */
  focusTool: (toolId: string) => void;
}
