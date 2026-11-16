// The non-blocking late-restore prompt (soak-fix reviews 3 and 4) — a lazy
// chunk, loaded only when a startup restore lands where applying it
// automatically could mix with or overwrite the user's work: after a failed
// first attempt, once the workspace was replaced, a project opened or data
// imported, or at a startup that carries an unanswered recovery over from
// the previous page (lib/autosave.ts's pending-recovery marker).
//
//   "Recovered previous session — Append / Replace / Discard"
//
//  - Replace: the WHOLE saved workspace (folders, figures, reports, windows,
//    view) through the same path File ▸ Open uses, and behind the same
//    "Replace the current workspace?" confirmation when there is anything to
//    lose; as an unnamed library, never under an opened project's identity.
//    Settles the pin once done; Cancel keeps everything as it was.
//  - Append: the full library beside the current work — datasets, workbooks
//    (back in their folders) and analysis results (Append Project), then
//    folders, figures, pages, reports, smart folders, collections, saved ROIs
//    and map views. It does NOT settle: the full copy stays pinned, and the
//    prompt then offers only Replace or Discard.
//  - Discard: after a confirmation, settles the pin; the old generations then
//    rotate out normally.
// Ignoring the prompt keeps the pin, across reloads too (the marker): the
// next startup offers the same generation again rather than letting this
// session's saves rotate it out. The status bar's label re-opens the prompt.
// A workspace replace while it is pending (Remove all, New, Open) keeps it as
// well, and says so (review F6: the safe choice — nothing is discarded
// without an explicit Discard).

import { askConfirm } from "../store/confirmDialog";
import { reportAutosaveHealth } from "../store/autosaveStatus";
import { toast, useToasts } from "../store/toasts";
import { useApp, type AppState } from "../store/useApp";
import { onWorkspaceReplace } from "../store/workspaceReplace";
import { autosaveHealth, autosaveRestorePending, autosaveRestoreSettled } from "./autosave";
import { hasWorkspaceContent, replaceConfirmMessage, replaceWorkspace } from "./openWorkspaceReplace";
import type { LoadedWorkspace } from "./workspace";

interface Held {
  workspace: LoadedWorkspace;
  at: number;
  /** Already appended once: only Replace or Discard remain (review F4). */
  appended?: boolean;
}
let held: Held | null = null;

const PENDING = "The previous session's autosave is waiting: choose Append, Replace or Discard (click to choose again)";
const KEPT = "The previous session was appended; its full copy is kept until you Replace or Discard it (click to choose)";
const PROMPT = "Recovered previous session";
const report = () => reportAutosaveHealth(autosaveHealth());
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

// Review F6: a replace while a recovery is pending never discards it.
onWorkspaceReplace(() => {
  if (held) toast("The previous session's autosave is still kept — choose Replace or Discard from the status bar", "info");
});

/** Hold `picked` and ask. The pin stays until Discard or a Replace. */
export function offerLateRestore(picked: Held): void {
  held = { workspace: picked.workspace, at: picked.at };
  autosaveRestorePending(PENDING, picked.at + 1);
  report();
  reofferLateRestore();
}

/** Show the prompt (again) — replacing one already showing, never stacking
 *  another (review F9). False when nothing is held. */
export function reofferLateRestore(): boolean {
  if (!held) return false;
  const { dismiss, toasts } = useToasts.getState();
  for (const t of toasts) if (t.msg.startsWith(PROMPT)) dismiss(t.id);
  const n = held.workspace.datasets.length;
  const when = new Date(held.at).toLocaleString();
  const choices = [
    ...(held.appended ? [] : [{ label: "Append", onClick: () => void appendRecovered() }]),
    { label: "Replace", onClick: () => void replaceRecovered() },
    { label: "Discard", onClick: () => void discardRecovered() },
  ];
  const ask = held.appended ? "already appended — Replace or Discard?" : "Append, Replace or Discard?";
  toast(`${PROMPT} (${plural(n, "dataset")}, ${when}) — ${ask}`, "info", { actions: choices, ttlMs: 10 * 60_000 });
  return true;
}

/** Replace the live workspace with the recovered one, whole — after the same
 *  confirmation File ▸ Open asks when there is anything to lose (review F1).
 *  Resolves whether it replaced; a Cancel keeps everything, the pin included. */
export async function replaceRecovered(): Promise<boolean> {
  const mine = held;
  if (!mine) return false;
  const s = useApp.getState;
  if (hasWorkspaceContent(s)) {
    const ok = await askConfirm("Replace the current workspace?", replaceConfirmMessage(s().datasets.length), "Replace", true);
    if (!ok || held !== mine) return false;
  }
  held = null; // before the replace, which announces itself (the F6 notice)
  if (!replaceWorkspace(s, mine.workspace)) {
    held = mine;
    return false;
  }
  autosaveRestoreSettled();
  report();
  toast("Replaced the workspace with the recovered previous session (Ctrl+Z undoes it)", "info");
  return true;
}

/** Forget the recovered session, once confirmed; its generations then rotate
 *  out normally. Resolves whether it discarded. */
export async function discardRecovered(): Promise<boolean> {
  const mine = held;
  if (!mine) return false;
  const ok = await askConfirm(
    "Discard the previous session?",
    "Its autosave stops being kept and is replaced by newer autosaves. This cannot be undone.",
    "Discard",
    true,
  );
  if (!ok || held !== mine) return false;
  held = null;
  autosaveRestoreSettled();
  report();
  toast("Discarded the recovered previous session", "info");
  return true;
}

type Keyed = { id: string };
const LIBRARY = ["folders", "originFigures", "figureDocs", "editableFigures", "pages", "reports", "smartFolders", "collections", "savedRois"] as const;

/** Add the recovered library beside the current work. Resolves whether the
 *  datasets went in; a failure keeps the prompt answerable (review R6). */
export async function appendRecovered(): Promise<boolean> {
  const mine = held;
  if (!mine || mine.appended) return false;
  const ws = mine.workspace;
  const s = useApp.getState;
  const before = new Set(s().datasets.map((d) => d.id));
  let ok: boolean;
  try {
    ok = await s().appendWorkspace(ws);
  } catch (e) {
    if (held !== mine) return false;
    autosaveRestorePending(`Couldn't append the previous session (${e instanceof Error ? e.message : "load failed"}) — it is kept; click to choose again`);
    report();
    return false;
  }
  // Review F5: the merge chunk loads first — a Replace or Discard answered
  // meanwhile owns the outcome; nothing here may re-pin over it.
  if (!ok || held !== mine) return false;
  const st = s();
  // What actually joined, measured AFTER the merge: a recovered dataset whose
  // id is not among the new ones was remapped, and then the rest of the
  // library (which keeps its ids and dataset references) stays behind.
  const joined = new Set(st.datasets.filter((d) => !before.has(d.id)).map((d) => d.id));
  const remapped = ws.datasets.some((d) => !joined.has(d.id));
  const patch: Partial<AppState> = {};
  let added = 0;
  let left = 0;
  for (const key of LIBRARY) {
    const theirs = ((ws as Partial<Record<typeof key, Keyed[]>>)[key] ?? []) as Keyed[];
    const kept = st[key] as readonly Keyed[];
    const fresh = remapped ? [] : theirs.filter((x) => !kept.some((m) => m.id === x.id));
    added += fresh.length;
    left += theirs.length - fresh.length;
    if (fresh.length) (patch as Record<string, unknown>)[key] = [...kept, ...fresh];
  }
  if (!remapped) Object.assign(patch, placement(ws, st, joined, new Set(((patch.folders ?? []) as Keyed[]).map((f) => f.id))));
  // One set, after appendWorkspace recorded history: one Ctrl+Z undoes all.
  useApp.setState(patch);
  mine.appended = true;
  autosaveRestorePending(KEPT, undefined, true);
  report();
  const project = st.currentProject ? ` — added to ${st.currentProject.name}; save to keep it there` : "";
  toast(
    `Appended the previous session: ${plural(ws.datasets.length, "dataset")}` +
      (added ? ` and ${plural(added, "other library item")}` : "") +
      (left ? `; ${plural(left, "item")} could not join (ids in use) — Replace restores everything` : "") +
      `${project}. The full copy stays available until you Discard it.`,
    left ? "danger" : "info",
  );
  return true;
}

/** Folder placement for what an Append brought in (review F3): the Library
 *  places a worksheet under its WORKBOOK and the workbook by its own
 *  `folderId`, which Append Project clears (each workbook arrives under a
 *  fresh id). Map every joined dataset's new workbook back to its recovered
 *  workbook's folder, and put loose datasets back in theirs. */
function placement(ws: LoadedWorkspace, st: AppState, joined: ReadonlySet<string>, folders: ReadonlySet<string>): Partial<AppState> {
  const origin = new Map(ws.datasets.map((d) => [d.id, d]));
  const wbFolder = new Map((ws.workbooks ?? []).flatMap((w) => (w.folderId && folders.has(w.folderId) ? [[w.id, w.folderId] as const] : [])));
  const newWbFolder = new Map<string, string>();
  const datasets = st.datasets.map((d) => {
    if (!joined.has(d.id)) return d;
    const was = origin.get(d.id);
    const folder = was?.workbookId ? wbFolder.get(was.workbookId) : undefined;
    if (folder && d.workbookId) newWbFolder.set(d.workbookId, folder);
    return was?.folderId && folders.has(was.folderId) && d.folderId !== was.folderId ? { ...d, folderId: was.folderId } : d;
  });
  const workbooks = st.workbooks.map((w) => (newWbFolder.has(w.id) ? { ...w, folderId: newWbFolder.get(w.id) } : w));
  const views = Object.fromEntries(Object.entries(ws.mapViews ?? {}).filter(([id]) => !(id in st.mapViews)));
  return {
    datasets,
    ...(newWbFolder.size ? { workbooks } : {}),
    ...(Object.keys(views).length ? { mapViews: { ...st.mapViews, ...views } } : {}),
  };
}

/** Test seam. */
export function resetLateRestore(): void {
  held = null;
}
