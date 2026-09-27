// The body of `splitDatasetByColumn` (store/split.ts, which documents what
// carries to each child and why). Lazy: the slice imports this on the first
// split. The grouping, the child data and the warnings come from
// lib/splitCompute.ts — the SAME compute the Split dialog's live preview ran.
import { childFolders, createFolder as treeCreateFolder } from "../lib/foldertree";
import { lit } from "../lib/macro";
import { nextStageTab } from "../lib/stagetab";
import type { Dataset } from "../lib/types";
import { refreshFitRefs } from "../lib/derivedFitRefs";
import { toast } from "./toasts";
import { nextDatasetId, nextFolderId } from "./idSeq";
import type { SliceGet, SliceSet } from "./split";
import { datasetViewDefaults, focusTransientReset } from "./windows";

export async function runSplit(
  set: SliceSet,
  get: SliceGet,
  id: string,
  col: number,
  tolerance: number | undefined,
): Promise<string[]> {
  // A never-activated, still-pending Origin book only carries a small
  // downsampled preview (ORIGIN_FILE_DECODE_PLAN #38) — resolve the
  // full data first so the split groups the REAL rows, not a preview's.
  await get().resolveDataset(id);
  const src = get().datasets.find((d) => d.id === id);
  if (!src) return [];

  // The SAME compute the dialog's live preview ran (lib/splitCompute.ts).
  const [{ tooManyGroups }, { computeSplit, splitChildData }] = await Promise.all([
    import("../lib/datasetsplit"),
    import("../lib/splitCompute"),
  ]);
  const { groups, warnings } = computeSplit(src, col, tolerance);
  if (groups.length < 2) {
    toast(`"${src.name}" doesn't split into more than one group on that column`, "danger");
    return [];
  }
  if (tooManyGroups(groups)) {
    toast(`too many groups (${groups.length}) — pick a different column or a wider tolerance`, "danger");
    return [];
  }
  // P2.5: rows with no split value land in "(other)" — `warnings` says
  // so on every child, beside the provenance; a replayable step is recorded.

  get().recordHistory("split dataset");
  // Re-splitting the same source (e.g. after tweaking the tolerance)
  // must not mint a SECOND identically-named sibling folder — reuse the
  // existing one if a prior split already created it under the same
  // parent. Only an exact name match counts as "the same split family";
  // an unrelated folder that happens to share a name some other way is
  // never touched.
  const existingFolder = childFolders(get().folders, src.folderId ?? null).find(
    (f) => f.name === (src.name.trim() || "New Folder"),
  );
  const folderId = existingFolder ? existingFolder.id : nextFolderId();
  // Read BEFORE the commit below makes the first child active.
  const inputIsTarget = get().activeId === id;
  const children: Dataset[] = groups.map((g) => {
    const child: Dataset = {
      id: nextDatasetId(),
      name: `${src.name} (${g.label})`,
      // `split_group` names the group; pipeline replay matches a recorded
      // child to its replay counterpart by it (lib/transformReplay.ts).
      data: splitChildData(src.data, g, warnings),
      folderId,
    };
    if (src.formulas?.length) child.formulas = src.formulas.map((f) => ({ ...f }));
    if (src.channelRoles) child.channelRoles = { ...src.channelRoles };
    if (src.channelTypes) child.channelTypes = { ...src.channelTypes };
    // F5: preserve `[]` (O1 marker) vs `undefined` exactly -- `[]` is
    // truthy, so this carries an explicit empty array too, unlike a
    // `?.length` guard which would collapse it to "not carried".
    if (src.errorRoles) child.errorRoles = [...src.errorRoles];
    // P2.5: a child has no saved fit of its own, so its copied fit() columns
    // must say so rather than keep showing the source's fitted values.
    return refreshFitRefs(child);
  });
  const firstChild = children[0];

  set((s) => ({
    folders: existingFolder
      ? s.folders
      : treeCreateFolder(s.folders, src.folderId ?? null, src.name, folderId),
    datasets: [...s.datasets, ...children],
    activeId: firstChild.id,
    worksheetId: null,
    selectedIds: children.map((c) => c.id),
    librarySelection: null, // L0.25 coherence (retrospective-audit fix)
    stageTab: nextStageTab(firstChild, s.stageTab),
    ...datasetViewDefaults(firstChild),
    ...focusTransientReset(),
    expandedFolders: [...new Set([...s.expandedFolders, folderId])],
    splitDialogTargetId: null,
  }));

  get().recordMacro(`Split ${src.name} by column value`, `qz.transform("split", "<active>", ${lit({ col, tolerance: tolerance ?? null })})`, {
    kind: "transform",
    // Same provenance shape as lib/transformRun.recordedProvenance (not
    // imported, so a split does not also load the whole transform runner).
    params: {
      op: "split",
      col,
      tolerance: tolerance ?? null,
      input: { id, name: src.name },
      inputIsTarget,
      outputs: children.map((c, k) => ({ id: c.id, key: groups[k].label })),
    },
  });
  get().setStatus(`split "${src.name}" into ${children.length} datasets`);
  toast(`split into ${children.length} datasets`, "ok");
  return children.map((c) => c.id);
}
