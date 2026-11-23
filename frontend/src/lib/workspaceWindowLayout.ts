// The `.dwk` top-level `windowLayout` key (WORKSPACE_LAYOUT_PLAN P0), both
// directions. Part of the lazy workspace codec (lib/workspaceCodecLazy.ts),
// so the layout sanitizer it pulls in never reaches the eager bundle.
//
// WRITE: only while windows mode is on. A classic user's save carries no key
// and keeps its version, byte for byte. A file WITH the key is written as v8
// (lib/workspaceForwardCompat.ts NEW_SINCE_V041): v0.39-v0.41 accept v7 and
// would drop the key on open + save (measured against `git archive v0.41.0`),
// so they must refuse the file instead (owner decision D10).
//
// READ: never blocks the project. A layout this build cannot read whole is
// dropped with one `migrationWarnings` note (the host re-seeds); a single
// window it cannot place is dropped, and named in the note.

import { pruneRefs } from "./windowLayout/ops";
import { kindOf } from "./windowLayout/refs";
import type { PlotWindow } from "./plotview";
import { sanitizeWindowLayout, windowLayoutWarning } from "./windowLayout/sanitize";
import type { LayoutMode, WindowLayoutV1 } from "./windowLayout/types";

/** The saved layout, or null when the file has none or it was refused. */
export function parseSavedWindowLayout(
  raw: unknown,
  plotWindows: readonly PlotWindow[],
  datasetIds: ReadonlySet<string>,
  migrationWarnings: string[],
  viewport?: { width: number; height: number },
): WindowLayoutV1 | null {
  if (raw === undefined || raw === null) return null;
  const result = sanitizeWindowLayout(raw, { plotIds: new Set(plotWindows.map((w) => w.id)), datasetIds, viewport });
  const note = windowLayoutWarning(result);
  if (note) migrationWarnings.push(note);
  return result.layout;
}

/** What a save writes under `windowLayout`: the layout while windows mode is
 *  on, otherwise nothing (undefined, so the key is omitted). Placements for
 *  plot windows the project no longer has, and a Data pin to a dataset it no
 *  longer has, are left out, so a reopen never warns about a window the user
 *  closed. */
export function windowLayoutForSave(ws: {
  windowLayout?: WindowLayoutV1 | null;
  layoutMode?: LayoutMode;
  plotWindows?: readonly PlotWindow[];
  datasets?: readonly { id: string }[];
}): WindowLayoutV1 | undefined {
  if (ws.layoutMode !== "windows" || !ws.windowLayout) return undefined;
  const plots = new Set((ws.plotWindows ?? []).map((w) => `plot:${w.id}`));
  const pruned = pruneRefs(ws.windowLayout, (r) => kindOf(r) !== "plot" || plots.has(r));
  const pin = pruned.data.pinned;
  return pin !== null && !(ws.datasets ?? []).some((d) => d.id === pin) ? { ...pruned, data: { ...pruned.data, pinned: null } } : pruned;
}
