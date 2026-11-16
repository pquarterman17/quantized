// The non-blocking late-restore prompt (soak-fix review 3, R2/R3/R5/R7) — a
// lazy chunk, loaded only when a startup restore lands where applying it
// automatically could mix with or overwrite the user's work: after a failed
// first attempt, or once the workspace was replaced or a project opened.
//
//   "Recovered previous session — Append / Replace / Discard"
//
//  - Replace: the WHOLE saved workspace (folders, figures, reports, windows,
//    view) through the same path File ▸ Open uses, as an unnamed library —
//    never under an opened project's identity. Settles the pin once done.
//  - Append: the full library contents beside the current work — datasets,
//    workbooks and analysis results (Append Project), then folders, figures,
//    pages, reports, smart folders, collections, saved ROIs and map views. It
//    does NOT settle: the full generation stays pinned, so Replace or Discard
//    can still be chosen (re-offered from the status bar).
//  - Discard: settles the pin; the old generations rotate out normally.
// Ignoring the prompt is safe: the pin holds for the session, bounded by the
// age and byte caps, and the status bar's "previous session not restored"
// offers it again.

import { reportAutosaveHealth } from "../store/autosaveStatus";
import { toast } from "../store/toasts";
import { useApp, type AppState } from "../store/useApp";
import { autosaveHealth, autosaveRestorePending, autosaveRestoreSettled } from "./autosave";
import { replaceWorkspace } from "./openWorkspaceReplace";
import type { LoadedWorkspace } from "./workspace";

interface Held {
  workspace: LoadedWorkspace;
  at: number;
}
let held: Held | null = null;

const PENDING = "The previous session's autosave is waiting: choose Append, Replace or Discard (click to choose again)";
const report = () => reportAutosaveHealth(autosaveHealth());
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Hold `picked` and ask. The pin stays until Discard or a Replace. */
export function offerLateRestore(picked: Held): void {
  held = picked;
  autosaveRestorePending(PENDING);
  report();
  reofferLateRestore();
}

/** Show the prompt again (the status bar's "previous session" label). */
export function reofferLateRestore(): void {
  if (!held) return;
  const n = held.workspace.datasets.length;
  toast(`Recovered previous session (${plural(n, "dataset")}, ${new Date(held.at).toLocaleString()}) — Append, Replace or Discard?`, "info", {
    actions: [
      { label: "Append", onClick: () => void appendRecovered() },
      { label: "Replace", onClick: () => void replaceRecovered() },
      { label: "Discard", onClick: discardRecovered },
    ],
    ttlMs: 10 * 60_000,
  });
}

/** Replace the live workspace with the recovered one, whole. */
export function replaceRecovered(): boolean {
  if (!held) return false;
  if (!replaceWorkspace(useApp.getState, held.workspace)) return false;
  held = null;
  autosaveRestoreSettled();
  report();
  toast("Replaced the workspace with the recovered previous session", "info");
  return true;
}

/** Forget the recovered session; its generations rotate out normally. */
export function discardRecovered(): void {
  held = null;
  autosaveRestoreSettled();
  report();
  toast("Discarded the recovered previous session", "info");
}

type Keyed = { id: string };
const LIBRARY = ["folders", "originFigures", "figureDocs", "editableFigures", "pages", "reports", "smartFolders", "collections", "savedRois"] as const;

/** Add the recovered library beside the current work. Resolves whether the
 *  datasets went in; a failure keeps the prompt answerable (review R6). */
export async function appendRecovered(): Promise<boolean> {
  if (!held) return false;
  const ws = held.workspace;
  const s = useApp.getState;
  const before = new Set(s().datasets.map((d) => d.id));
  let ok: boolean;
  try {
    ok = await s().appendWorkspace(ws);
  } catch (e) {
    autosaveRestorePending(`Couldn't append the previous session (${e instanceof Error ? e.message : "load failed"}) — it is kept; click to choose again`);
    report();
    return false;
  }
  if (!ok) return false;
  // The rest of the library keeps its ids, so its dataset references only
  // hold while no dataset id was remapped; an entity whose id is taken, or
  // any of them after a remap, stays in the recovery copy (still pinned).
  const remapped = ws.datasets.some((d) => before.has(d.id));
  const st = s();
  const patch: Partial<AppState> = {};
  let added = 0;
  let left = 0;
  for (const key of LIBRARY) {
    const theirs = ((ws as Partial<Record<typeof key, Keyed[]>>)[key] ?? []) as Keyed[];
    const mine = st[key] as readonly Keyed[];
    const fresh = remapped ? [] : theirs.filter((x) => !mine.some((m) => m.id === x.id));
    added += fresh.length;
    left += theirs.length - fresh.length;
    if (fresh.length) (patch as Record<string, unknown>)[key] = [...mine, ...fresh];
  }
  if (!remapped) {
    // Datasets go back into the folders that came with them.
    const folders = new Set(((patch.folders ?? []) as Keyed[]).map((f) => f.id));
    const folderOf = new Map(ws.datasets.flatMap((d) => (d.folderId && folders.has(d.folderId) ? [[d.id, d.folderId] as const] : [])));
    if (folderOf.size) patch.datasets = st.datasets.map((d) => (!before.has(d.id) && folderOf.has(d.id) ? { ...d, folderId: folderOf.get(d.id) } : d));
    const theirViews = ws.mapViews ?? {};
    const views = Object.fromEntries(Object.entries(theirViews).filter(([id]) => !(id in st.mapViews)));
    if (Object.keys(views).length) patch.mapViews = { ...st.mapViews, ...views };
  }
  // One set, after appendWorkspace recorded history: one Ctrl+Z undoes all.
  useApp.setState(patch);
  toast(
    `Appended the previous session: ${plural(ws.datasets.length, "dataset")}` +
      (added ? ` and ${plural(added, "other library item")}` : "") +
      (left ? `; ${plural(left, "item")} could not join (ids in use) — Replace restores everything` : "") +
      ". The full copy stays available until you Discard it.",
    left ? "danger" : "info",
  );
  return true;
}

/** Test seam. */
export function resetLateRestore(): void {
  held = null;
}
