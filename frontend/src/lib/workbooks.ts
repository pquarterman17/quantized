// Pure workbook model + legacy derivation (LIBRARY_WORKBOOK_UX_PLAN PR A1).
//
// The plan's confirmed hierarchy (L0.1) is folder -> workbook -> workbook
// children (worksheets, editable figures, analyses, notes). Today only
// `folder -> dataset` exists (`Dataset.folderId`, lib/foldertree.ts); this
// module adds the missing middle layer as a first-class, derivable object —
// `WorkbookNode` plus `Dataset.workbookId` (added to lib/types.ts in the same
// PR) — without touching the store, the workspace document, or any UI. That
// wiring is PR A2's job (LIBRARY_WORKBOOK_UX_PLAN "Recommended PR A
// decomposition"); this module only needs to be correct in isolation so A2
// can call it from `loadWorkspace` unchanged.
//
// `deriveWorkbooks` is the legacy-migration entry point: given today's flat
// `datasets[]` + `folders[]` (v1-v3 documents, or any document with datasets
// that lack a `workbookId`), it deterministically reconstructs the workbook
// grouping the owner confirmed:
//
//   L0.2 default boundary — one imported SOURCE FILE becomes one workbook.
//   L0.3 multi-sheet source — every sheet of one source file stays a child
//        of that file's workbook.
//   L0.16 child order — worksheets in SOURCE order first (the rest of the
//        L0.16 ordering — figures, analyses, notes — is a PR B/C concern;
//        this module only orders WORKSHEET members, i.e. `membership`).
//
// Origin multi-sheet books (`Dataset.data.metadata.origin_book`) already
// group via lib/grouping.ts's `originSheetGroups` (rendering) and
// lib/originFolders.ts's `planOriginFolders` (fresh-import folder creation).
// Neither fits this job directly: `originSheetGroups` EXCLUDES single-sheet
// groups (fine for a "relate these siblings" render helper, wrong here — the
// acceptance gate is "a single-sheet source still has a visible workbook
// container"), and `planOriginFolders` CREATES new folders for a fresh
// import rather than recognizing an EXISTING folder that already plays the
// role of a workbook surrogate (a legacy document's `planOriginFolders`
// output, sitting in `folders[]` since before workbooks existed). So this
// module reuses `originSheetGroups`'s exact grouping key (`importStem` +
// base book name, both exported from lib/grouping.ts) and its
// `originSheetNumber` sort, but re-implements the grouping loop itself to
// keep singleton groups. An agreement test (workbooks.test.ts) asserts the
// two partitions never diverge on the shared (multi-sheet) subset.

import { originSheetNumber, importStem } from "./grouping";
import { orderBetween } from "./order";
import type { Dataset, FolderNode } from "./types";

/** A first-class workbook (L0.1's middle hierarchy layer). Membership is
 *  recorded on the DATASET (`Dataset.workbookId`), the same design as
 *  `FolderNode`/`Dataset.folderId`: a workbook never lists its children, so
 *  deleting a member can never leave a dangling reference here. */
export interface WorkbookNode {
  id: string;
  name: string;
  /** Containing folder id; absent = Library root. Folder placement is owned
   *  by the WORKBOOK (members' folderId becomes derived once A2+ rewires). */
  folderId?: string;
  /** Sort key among siblings in the same folder (lib/order conventions). */
  order?: number;
  /** Import provenance, carried from the members that established this
   *  workbook. Absent when unknowable (uploads, hand-created data). */
  source?: { kind: "path"; path: string };
  importedAt?: string;
  /** Base Origin book name ("Book4", no "@N") for workbooks recovered from
   *  an Origin project import. */
  originBook?: string;
}

export interface WorkbookDerivation {
  workbooks: WorkbookNode[];
  /** datasetId -> workbookId. TOTAL: every input dataset appears exactly once. */
  membership: Record<string, string>;
  /** Folder ids identified as convertible Origin book-surrogate folders
   *  (the planOriginFolders pattern). A1 only IDENTIFIES them; A3 applies
   *  the conversion. */
  convertedFolderIds: string[];
  /** Human-readable migration notices (same spirit as workspace.ts
   *  migrationWarnings). Empty on clean input. */
  warnings: string[];
}

/** `data.metadata.origin_book`, or undefined when the dataset carries none
 *  (not an Origin import, or an Origin import whose reader couldn't stamp
 *  it). Mirrors the identical check in lib/grouping.ts/lib/originFolders.ts. */
function originBookMeta(d: Dataset): string | undefined {
  const meta = d.data.metadata as Record<string, unknown> | undefined;
  const raw = meta?.origin_book;
  return typeof raw === "string" && raw ? raw : undefined;
}

/** Base book name with the "@N" sheet suffix dropped: "Book4@2" -> "Book4".
 *  Byte-equivalent to lib/originFolders.ts's private `bookBase` and the
 *  inline `raw.split("@")[0] || raw` in lib/grouping.ts's `originSheetGroups`
 *  — re-derived here (rather than imported) because both are private to
 *  their modules; the agreement test below pins the two against drift. */
function originBookBase(raw: string): string {
  return raw.split("@")[0] || raw;
}

/** Basename without directory — byte-equivalent to
 *  store/importDatasets.ts's `pathBasename`, re-derived here because this
 *  module must stay store-free (no store/ imports, per the pure-layer rule). */
function pathBasename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** The file's basename with its extension stripped — byte-equivalent to the
 *  `stem` computation in store/importDatasets.ts's `addFromPayload`
 *  (`origin.name.replace(/\.[^.]+$/, "")`), applied to a path's basename. A
 *  plain (non-Origin) dataset's OWN `Dataset.name` keeps its extension
 *  (`addFromPayload` sets `name: origin.name` verbatim) — so the workbook
 *  name is deliberately NOT read off `d.name`, only off `d.source.path`. */
function pathStemName(path: string): string {
  const base = pathBasename(path);
  const stem = base.replace(/\.[^.]+$/, "");
  return stem || base;
}

/** The folderId shared by the most members, ties broken by the first
 *  member's own folderId (root/`undefined` counts as a location like any
 *  other). Used both as rule 2's non-conversion fallback and as rule 3's
 *  placement for a combined-source group. */
function mostCommonFolderId(members: readonly Dataset[]): string | undefined {
  const counts = new Map<string | undefined, number>();
  const firstSeen: (string | undefined)[] = [];
  for (const d of members) {
    if (!counts.has(d.folderId)) {
      counts.set(d.folderId, 0);
      firstSeen.push(d.folderId);
    }
    counts.set(d.folderId, counts.get(d.folderId)! + 1);
  }
  let best = firstSeen[0];
  let bestCount = counts.get(best) ?? 0;
  for (const fid of firstSeen) {
    const c = counts.get(fid)!;
    if (c > bestCount) {
      best = fid;
      bestCount = c;
    }
  }
  return best;
}

/** Do this group's members occupy more than one folder (root counts as one
 *  location)? Drives whether the spread warning fires. */
function spansMultipleFolders(members: readonly Dataset[]): boolean {
  return new Set(members.map((d) => d.folderId)).size > 1;
}

/** Rule 2: does this Origin group sit in an EXISTING folder that exactly
 *  matches the `planOriginFolders` book-surrogate shape — every member (and
 *  ONLY these members) inside one folder named after the base book, itself
 *  childless? All four conditions must hold; any miss (renamed folder, an
 *  extra occupant, a child folder, members spread across folders) means "do
 *  not convert" and the caller falls back to `mostCommonFolderId`. */
function detectSurrogateFolder(
  members: readonly Dataset[],
  baseBookName: string,
  folders: readonly FolderNode[],
  allDatasets: readonly Dataset[],
): { folderId: string; parentId?: string } | null {
  const first = members[0].folderId;
  if (first === undefined) return null; // the Library root is never a surrogate folder
  if (!members.every((d) => d.folderId === first)) return null;
  const folder = folders.find((f) => f.id === first);
  if (!folder || folder.name !== baseBookName) return null;
  const occupants = allDatasets.filter((d) => d.folderId === folder.id);
  if (occupants.length !== members.length) return null; // an extra unrelated dataset
  if (folders.some((f) => f.parentId === folder.id)) return null; // a child folder
  return { folderId: folder.id, parentId: folder.parentId ?? undefined };
}

type GroupKind = "origin" | "path" | "singleton";

interface Group {
  kind: GroupKind;
  /** Origin base book name (kind === "origin" only). */
  base?: string;
  members: Dataset[];
}

/** The grouping key for one dataset, per the confirmed L0.1-L0.3 rules
 *  (applied in this priority order):
 *
 *  1. Origin-stamped (`data.metadata.origin_book` set) -> grouped by the same
 *     stem-scoped key `originSheetGroups` uses, so two unrelated Origin
 *     imports that both happen to contain "Book1" never merge.
 *  2. A path import with a known `importedAt` -> grouped by (path,
 *     importedAt) exactly — the same file re-imported at a different time is
 *     a SEPARATE workbook (a separate import event), never silently merged.
 *  3. Everything else (uploads, hand-created data, a path with no
 *     `importedAt`) -> a singleton, keyed on the dataset's own id so it can
 *     never collide with another group. */
function groupKeyOf(d: Dataset): { kind: GroupKind; key: string; base?: string } {
  const raw = originBookMeta(d);
  if (raw) {
    const base = originBookBase(raw);
    return { kind: "origin", key: JSON.stringify(["origin", importStem(d), base]), base };
  }
  if (d.source?.kind === "path" && d.source.path && d.importedAt) {
    return { kind: "path", key: JSON.stringify(["path", d.source.path, d.importedAt]) };
  }
  return { kind: "singleton", key: `singleton:${d.id}` };
}

/**
 * Derive workbooks for `datasets` that have none yet — the v1-v3 legacy
 * migration path, and `reconcileWorkbookRefs`'s repair path for orphaned
 * datasets. Pure and deterministic: identical inputs plus a deterministic
 * `genId` produce identical output, byte for byte. Workbook list order and
 * per-folder `order` both follow FIRST APPEARANCE in `datasets`.
 *
 * `occupancy` is the FULL document's dataset list for rule 2's
 * folder-exclusivity check; it defaults to `datasets` (the whole-document
 * migration case) but a partial derivation (reconcile's orphan repair) must
 * pass the complete list — judging occupancy from the derivation subset
 * alone would flag a folder as a convertible surrogate while a
 * valid-membership tenant still lives in it.
 */
export function deriveWorkbooks(
  datasets: readonly Dataset[],
  folders: readonly FolderNode[],
  genId: () => string,
  occupancy: readonly Dataset[] = datasets,
): WorkbookDerivation {
  // Pass 1: bucket datasets into ordered groups (first-appearance order of
  // each group's KEY, mirroring lib/originFolders.ts's `planOriginFolders`).
  const order: string[] = [];
  const groups = new Map<string, Group>();
  for (const d of datasets) {
    const { kind, key, base } = groupKeyOf(d);
    let g = groups.get(key);
    if (!g) {
      g = { kind, base, members: [] };
      groups.set(key, g);
      order.push(key);
    }
    g.members.push(d);
  }

  // Pass 2: materialize one WorkbookNode per group, in the same order.
  const warnings: string[] = [];
  const convertedFolderIds: string[] = [];
  const workbooks: WorkbookNode[] = [];
  const membership: Record<string, string> = {};

  for (const key of order) {
    const g = groups.get(key)!;
    const node: WorkbookNode = { id: genId(), name: "" };
    let sortedMembers = g.members;

    if (g.kind === "origin") {
      sortedMembers = [...g.members].sort((a, b) => originSheetNumber(a) - originSheetNumber(b));
      node.name = g.base!;
      node.originBook = g.base!;
      const surrogate = detectSurrogateFolder(g.members, g.base!, folders, occupancy);
      if (surrogate) {
        convertedFolderIds.push(surrogate.folderId);
        node.folderId = surrogate.parentId;
      } else {
        node.folderId = mostCommonFolderId(g.members);
        if (spansMultipleFolders(g.members)) {
          warnings.push(
            `Origin book "${g.base}" has sheets in more than one folder; placed the workbook at the most common one.`,
          );
        }
      }
    } else if (g.kind === "path") {
      const first = g.members[0];
      node.name = pathStemName(first.source!.path);
      node.source = first.source;
      node.importedAt = first.importedAt;
      node.folderId = mostCommonFolderId(g.members);
      if (spansMultipleFolders(g.members)) {
        warnings.push(
          `Imported source "${node.name}" has worksheets in more than one folder; placed the workbook at the most common one.`,
        );
      }
    } else {
      const only = g.members[0];
      node.name = only.name;
      node.folderId = only.folderId;
      if (only.source) node.source = only.source;
      if (only.importedAt) node.importedAt = only.importedAt;
    }

    workbooks.push(node);
    for (const d of sortedMembers) membership[d.id] = node.id;
  }

  // Pass 3: per-folder `order`, dense ascending by first appearance — reuses
  // lib/order.ts's `orderBetween` (before-only = "append") rather than a
  // hand-rolled counter, the same math lib/foldertree.ts's `createFolder` uses.
  const lastOrderByFolder = new Map<string | undefined, number>();
  for (const wb of workbooks) {
    const next = orderBetween(lastOrderByFolder.get(wb.folderId), undefined);
    wb.order = next;
    lastOrderByFolder.set(wb.folderId, next);
  }

  return { workbooks, membership, convertedFolderIds, warnings };
}

/** Validate an unknown value into `WorkbookNode[]` — same defensive style as
 *  workspace.ts's `parseFolders`: drop malformed entries (missing/wrong-typed
 *  `id`/`name`, duplicate `id`), coerce/drop bad optional fields, and drop a
 *  workbook's `folderId` if it names no folder in `folderIds` (the workbook
 *  itself is kept — it just falls back to the Library root, exactly how
 *  `parseFolders` reparents an orphaned folder to root rather than dropping
 *  it). */
export function sanitizeWorkbooks(v: unknown, folderIds: ReadonlySet<string>): WorkbookNode[] {
  if (!Array.isArray(v)) return [];
  const out: WorkbookNode[] = [];
  const seen = new Set<string>();
  for (const item of v) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    if (typeof o.id !== "string" || !o.id) continue;
    if (typeof o.name !== "string") continue;
    if (seen.has(o.id)) continue;
    seen.add(o.id);

    const node: WorkbookNode = { id: o.id, name: o.name };
    if (typeof o.folderId === "string" && folderIds.has(o.folderId)) node.folderId = o.folderId;
    if (typeof o.order === "number" && Number.isFinite(o.order)) node.order = o.order;
    if (typeof o.importedAt === "string" && o.importedAt) node.importedAt = o.importedAt;
    if (typeof o.originBook === "string" && o.originBook) node.originBook = o.originBook;
    if (typeof o.source === "object" && o.source !== null) {
      const s = o.source as Record<string, unknown>;
      if (s.kind === "path" && typeof s.path === "string" && s.path) {
        node.source = { kind: "path", path: s.path };
      }
    }
    out.push(node);
  }
  return out;
}

/**
 * Reference integrity over a parsed document: for every dataset whose
 * `workbookId` names no workbook in `workbooks` (dangling — a hand-edited or
 * corrupt `.dwk`, or simply absent, e.g. a pre-workbook document A2 hasn't
 * migrated in place), re-derive a workbook via `deriveWorkbooks` over the
 * ORPHANED subset only. Every dataset with an already-valid `workbookId`
 * keeps it untouched — this never rewrites a working membership, only fills
 * the gaps. Returns the combined workbook list, a FULL membership map
 * (covering every input dataset exactly once), and warnings.
 */
export function reconcileWorkbookRefs(
  datasets: readonly Dataset[],
  workbooks: readonly WorkbookNode[],
  folders: readonly FolderNode[],
  genId: () => string,
): WorkbookDerivation {
  const workbookIds = new Set(workbooks.map((w) => w.id));
  const membership: Record<string, string> = {};
  const orphaned: Dataset[] = [];
  const warnings: string[] = [];

  for (const d of datasets) {
    if (d.workbookId && workbookIds.has(d.workbookId)) {
      membership[d.id] = d.workbookId;
    } else {
      if (d.workbookId) {
        warnings.push(
          `dataset "${d.name}" referenced missing workbook "${d.workbookId}"; re-derived its workbook`,
        );
      }
      orphaned.push(d);
    }
  }

  if (orphaned.length === 0) {
    return { workbooks: [...workbooks], membership, convertedFolderIds: [], warnings };
  }

  const derived = deriveWorkbooks(orphaned, folders, genId, datasets);
  return {
    workbooks: [...workbooks, ...derived.workbooks],
    membership: { ...membership, ...derived.membership },
    convertedFolderIds: derived.convertedFolderIds,
    warnings: [...warnings, ...derived.warnings],
  };
}
