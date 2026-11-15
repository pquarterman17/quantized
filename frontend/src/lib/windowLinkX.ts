// "Link X axis with…" (origin gap audit 3 N3): pick, by name, the graph
// windows whose X axis follows this one — zoom or pan one and the others
// follow (and the crosshair tracks across them). It writes the windows'
// existing link group (`PlotWindow.linkGroup`, synced by lib/windowsync.ts and
// saved in the .dwk), so the title-bar link button, the save and the sync all
// agree; this is only the discoverable, named way to set it. One undo step.
//
// Loaded on demand (the plot right-click menu and the Plot menu command).

import { askParams } from "../store/paramDialog";
import { toast } from "../store/toasts";
import { useApp } from "../store/useApp";
import { displayedWindowTitle, MAX_LINK_GROUP } from "./plotWindows";
import type { PlotWindow } from "./plotview";

type LinkWin = Pick<PlotWindow, "id" | "kind" | "linkGroup">;

/** The link groups after linking window `id` with exactly `picked` (other
 *  plot windows): they share one group (this window's own, else the lowest one
 *  nobody else uses); windows that were in that group and are not picked
 *  leave it; picking none unlinks this window. Only CHANGED windows appear.
 *  null when every group is taken by other windows: another group is never
 *  borrowed (that would break up links the user did not touch). */
export function linkXGroups(windows: readonly LinkWin[], id: string, picked: readonly string[]): Map<string, number | null> | null {
  const self = windows.find((w) => w.id === id);
  const out = new Map<string, number | null>();
  if (!self) return out;
  const set = (w: LinkWin, g: number | null) => {
    if (w.linkGroup !== g) out.set(w.id, g);
  };
  if (picked.length === 0) {
    set(self, null);
    // A lone partner left behind in the group would link with nothing.
    const rest = windows.filter((w) => w.id !== id && self.linkGroup !== null && w.linkGroup === self.linkGroup);
    if (rest.length === 1) set(rest[0], null);
    return out;
  }
  const chosen = new Set(picked);
  const used = new Set(windows.filter((w) => w.id !== id && !chosen.has(w.id)).map((w) => w.linkGroup));
  let group = self.linkGroup;
  if (group === null) {
    group = 1;
    while (used.has(group) && group < MAX_LINK_GROUP) group++;
    if (used.has(group)) return null;
  }
  for (const w of windows) {
    if (w.id === id || chosen.has(w.id)) set(w, group);
    else if (w.linkGroup === group) set(w, null);
  }
  return out;
}

/** Ask which windows to link with the focused one, then apply. */
export async function linkXAxisWith(): Promise<void> {
  const s = useApp.getState();
  const id = s.focusedWindowId;
  const self = s.plotWindows.find((w) => w.id === id);
  if (!id || !self || self.kind !== "plot") {
    toast("focus a graph window first", "danger");
    return;
  }
  const others = s.plotWindows.filter((w) => w.id !== id && w.kind === "plot");
  if (others.length === 0) {
    toast("open another graph window to link with (Window ▸ New window)", "danger");
    return;
  }
  const name = (w: PlotWindow) => displayedWindowTitle(w, s.datasets);
  const values = await askParams(
    `Link X axis of “${name(self)}” with…`,
    others.map((w) => ({
      key: w.id,
      label: name(w),
      type: "boolean" as const,
      default: self.linkGroup !== null && w.linkGroup === self.linkGroup,
    })),
    { confirmLabel: "Link", message: "Zooming or panning X in one linked graph zooms the others; untick all to unlink." },
  );
  if (!values) return;
  const picked = others.filter((w) => values[w.id] === true).map((w) => w.id);
  const now = useApp.getState();
  const changes = linkXGroups(now.plotWindows, id, picked);
  if (changes === null) {
    toast(`all ${MAX_LINK_GROUP} link groups are in use — unlink one (its windows' link button) first`, "danger");
    return;
  }
  if (changes.size === 0) return;
  now.recordHistory("link X axes");
  useApp.setState((st) => ({
    plotWindows: st.plotWindows.map((w) => (changes.has(w.id) ? { ...w, linkGroup: changes.get(w.id)! } : w)),
  }));
  toast(picked.length ? `X axis linked with ${picked.length} window${picked.length === 1 ? "" : "s"}` : "X axis unlinked", "ok");
}
