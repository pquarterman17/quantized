// "Link X axis with…" (origin gap audit 3 N3): pick, by name, the graph
// windows whose X axis follows this one — zoom or pan one and the others
// follow (and the crosshair tracks across them). It writes the windows'
// existing link group (`PlotWindow.linkGroup`, synced by lib/windowsync.ts and
// saved in the .dwk), so the title-bar link button, the save and the sync all
// agree; this is only the discoverable, named way to set it. One undo step.
// "Link Y axis with…" (gap audit 4 G19) is the same model on its own field,
// `PlotWindow.linkYGroup` (the primary Y range only), with the same refusals.
// Either link joins only windows whose axis has the same KIND of scale
// (linear, log, log2, reciprocal, probability): a range pushed from a linear
// axis onto a log one would blank it. A window whose scale changes kind
// afterwards leaves its group, with a status message (`ensureLinkGuard`).
//
// Loaded on demand (the plot right-click menu and the Plot menu command).

import { askParams } from "../store/paramDialog";
import { toast } from "../store/toasts";
import { useApp } from "../store/useApp";
import { plotWindowView } from "../store/windowDocuments";
import { displayedWindowTitle, MAX_LINK_GROUP } from "./plotWindows";
import type { PlotView, PlotWindow } from "./plotview";

type LinkWin = Pick<PlotWindow, "id" | "kind" | "linkGroup" | "linkYGroup">;
/** Which link a call edits: X (`linkGroup`) or Y (`linkYGroup`). */
export type LinkField = "linkGroup" | "linkYGroup";

/** The link groups after linking window `id` with exactly `picked` (other
 *  plot windows): they share one group (this window's own, else the lowest one
 *  nobody else uses); windows that were in that group and are not picked
 *  leave it; picking none unlinks this window. Only CHANGED windows appear.
 *  null when every group is taken by other windows: another group is never
 *  borrowed (that would break up links the user did not touch). */
export function linkXGroups(windows: readonly LinkWin[], id: string, picked: readonly string[], field: LinkField = "linkGroup"): Map<string, number | null> | null {
  const self = windows.find((w) => w.id === id);
  const out = new Map<string, number | null>();
  if (!self) return out;
  const of = (w: LinkWin): number | null => w[field] ?? null;
  const set = (w: LinkWin, g: number | null) => {
    if (of(w) !== g) out.set(w.id, g);
  };
  const own = of(self);
  if (picked.length === 0) {
    set(self, null);
    // A lone partner left behind in the group would link with nothing.
    const rest = windows.filter((w) => w.id !== id && own !== null && of(w) === own);
    if (rest.length === 1) set(rest[0], null);
    return out;
  }
  const chosen = new Set(picked);
  const used = new Set(windows.filter((w) => w.id !== id && !chosen.has(w.id)).map(of));
  let group = own;
  if (group === null) {
    group = 1;
    while (used.has(group) && group < MAX_LINK_GROUP) group++;
    if (used.has(group)) return null;
  }
  for (const w of windows) {
    if (w.id === id || chosen.has(w.id)) set(w, group);
    else if (of(w) === group) set(w, null);
  }
  return out;
}

type KindView = Pick<PlotView, "xScale" | "yScale" | "xFmt" | "yFmt">;

/** The kind of scale `axis` has: "linear", "log" (log10 and ln place values
 *  alike), "log2", "reciprocal", or "prob:<unit>". */
export function scaleKind(view: KindView, axis: "x" | "y"): string {
  const scale = axis === "x" ? view.xScale : view.yScale;
  const fmt = axis === "x" ? view.xFmt : view.yFmt;
  if (scale === "linear" && fmt?.prob) return `prob:${fmt.prob}`;
  return scale === "log" && fmt?.base === "2" ? "log2" : scale;
}

const KIND_NAME: Record<string, string> = { "prob:fraction": "probability (0–1)", "prob:percent": "probability (%)" };
const kindName = (k: string): string => KIND_NAME[k] ?? k;

/** A window's live view: the focused one's is the store's own fields. */
function liveView(s: ReturnType<typeof useApp.getState>, w: PlotWindow): KindView {
  return w.id === s.focusedWindowId ? s : plotWindowView(w);
}

/** Ask which windows to link X with the focused one, then apply. */
export function linkXAxisWith(): Promise<void> {
  return linkAxisWith("x");
}

/** Ask which windows to link Y with the focused one, then apply. */
export function linkYAxisWith(): Promise<void> {
  return linkAxisWith("y");
}

async function linkAxisWith(axis: "x" | "y"): Promise<void> {
  const field: LinkField = axis === "x" ? "linkGroup" : "linkYGroup";
  const A = axis.toUpperCase();
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
    `Link ${A} axis of “${name(self)}” with…`,
    others.map((w) => ({
      key: w.id,
      label: name(w),
      type: "boolean" as const,
      default: (self[field] ?? null) !== null && w[field] === self[field],
    })),
    { confirmLabel: "Link", message: `Zooming or panning ${A} in one linked graph zooms the others; untick all to unlink.` },
  );
  if (!values) return;
  const picked = others.filter((w) => values[w.id] === true).map((w) => w.id);
  const now = useApp.getState();
  const own = scaleKind(liveView(now, self), axis);
  const clash = now.plotWindows.find((w) => picked.includes(w.id) && scaleKind(liveView(now, w), axis) !== own);
  if (clash) {
    toast(`can't link ${A} axes: “${name(clash)}” has a ${kindName(scaleKind(liveView(now, clash), axis))} ${A} axis and “${name(self)}” a ${kindName(own)} one`, "danger");
    return;
  }
  const changes = linkXGroups(now.plotWindows, id, picked, field);
  if (changes === null) {
    toast(`all ${MAX_LINK_GROUP} link groups are in use — unlink one (its windows' link button) first`, "danger");
    return;
  }
  if (changes.size === 0) return;
  now.recordHistory(`link ${A} axes`);
  useApp.setState((st) => ({
    plotWindows: st.plotWindows.map((w) => (changes.has(w.id) ? { ...w, [field]: changes.get(w.id)! } : w)),
  }));
  toast(picked.length ? `${A} axis linked with ${picked.length} window${picked.length === 1 ? "" : "s"}` : `${A} axis unlinked`, "ok");
}

let guarded = false;

/** The windows to unlink because their axis' scale kind no longer matches
 *  their group's: the focused window when it is the odd one out, else every
 *  member of a group that disagrees. */
export function linkClashes(s: ReturnType<typeof useApp.getState>, field: LinkField): string[] {
  const axis = field === "linkGroup" ? "x" : "y";
  const groups = new Map<number, PlotWindow[]>();
  for (const w of s.plotWindows) {
    const g = w.kind === "plot" ? w[field] ?? null : null;
    if (g !== null) groups.set(g, [...(groups.get(g) ?? []), w]);
  }
  const out: string[] = [];
  for (const members of groups.values()) {
    const kinds = new Set(members.map((w) => scaleKind(liveView(s, w), axis)));
    if (kinds.size < 2) continue;
    const focused = members.find((w) => w.id === s.focusedWindowId);
    out.push(...(focused ? [focused.id] : members.map((w) => w.id)));
  }
  return out;
}

/** Watch the store once: a linked window whose scale kind changes leaves its
 *  link group, with a status message, instead of being blanked by its
 *  partners' ranges. Installed by a linked plot (Stage/PlotViewport.tsx). */
export function ensureLinkGuard(): void {
  if (guarded) return;
  guarded = true;
  let seen: unknown[] = [];
  useApp.subscribe((s) => {
    const deps = [s.plotWindows, s.focusedWindowId, s.xScale, s.yScale, s.xFmt, s.yFmt];
    if (deps.every((d, i) => d === seen[i])) return;
    seen = deps;
    for (const field of ["linkGroup", "linkYGroup"] as const) {
      const off = linkClashes(s, field);
      if (off.length === 0) continue;
      const A = field === "linkGroup" ? "X" : "Y";
      useApp.setState((st) => ({ plotWindows: st.plotWindows.map((w) => (off.includes(w.id) ? { ...w, [field]: null } : w)) }));
      useApp.getState().setStatus(`${A} axis unlinked: its scale no longer matches the windows it was linked with`);
    }
  });
}
