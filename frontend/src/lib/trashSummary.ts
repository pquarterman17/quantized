// Trash panel display helpers (PRIMARY_SOFTWARE_AUDIT_PLAN P3.7). Pure and
// display-only — imported ONLY by the lazy-loaded TrashPanel, never by
// store/trash.ts itself: that file is EAGER (part of useApp's slice
// composition), so nothing that exists purely for the panel's rendering
// belongs there. See store/trash.ts's own header for the eager/lazy split.

import type { TrashEntry } from "../store/trash";

export interface TrashSummary {
  count: number;
  bytes: number;
  byKind: Record<TrashEntry["kind"], number>;
  oldestAt: number | null;
  /** `now - oldestAt`, for a "oldest 3d ago" purge-preview line. Null when
   *  the trash is empty. */
  oldestAgeMs: number | null;
}

/** Roll up the trash into the panel header/purge-preview's numbers. Pure —
 *  `now` is passed in so it's reproducible in tests, same convention as
 *  `evictTrash`. */
export function trashSummary(entries: readonly TrashEntry[], now: number): TrashSummary {
  const byKind: Record<TrashEntry["kind"], number> = {
    dataset: 0, editableFigure: 0, figureDoc: 0, page: 0, report: 0, folder: 0,
  };
  let bytes = 0;
  let oldestAt: number | null = null;
  for (const entry of entries) {
    byKind[entry.kind] += 1;
    bytes += entry.bytes;
    if (oldestAt === null || entry.at < oldestAt) oldestAt = entry.at;
  }
  return { count: entries.length, bytes, byKind, oldestAt, oldestAgeMs: oldestAt === null ? null : now - oldestAt };
}

/** A short human size — no existing formatter in `lib/` to reuse (checked:
 *  no `formatBytes`/`humanBytes`/`formatSize`). Binary units (KiB/MiB),
 *  matching `TRASH_MAX_BYTES`'s own MiB accounting. */
export function formatTrashBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/** One label per kind, for the panel's badges and the purge-preview line
 *  ("N datasets, M figures, …"). Singular/plural handled inline; order is
 *  the panel's own display order (datasets first — the original #32 kind —
 *  then everything P3.7 added). */
const KIND_LABELS: Record<TrashEntry["kind"], [string, string]> = {
  dataset: ["dataset", "datasets"],
  editableFigure: ["figure", "figures"],
  figureDoc: ["publication figure", "publication figures"],
  page: ["figure page", "figure pages"],
  report: ["report", "reports"],
  folder: ["folder", "folders"],
};
const TRASH_KIND_ORDER: readonly TrashEntry["kind"][] = [
  "dataset", "editableFigure", "figureDoc", "page", "report", "folder",
];

/** Coarse "3d ago" age, matching the Recent menu's register. Lives here
 *  (not the panel component) so `purgePreviewLine` can reuse it without a
 *  component->component import. */
export function trashAge(at: number, nowMs: number): string {
  const h = Math.max(0, Math.round((nowMs - at) / 3_600_000));
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

/** The purge-preview body's first line: "3 datasets, 1 figure — 12.4 KiB —
 *  oldest 3d ago". Empty trash never reaches the confirm (the button is
 *  hidden), so this assumes `summary.count > 0`. */
export function purgePreviewLine(summary: TrashSummary, now: number): string {
  const parts = TRASH_KIND_ORDER.filter((k) => summary.byKind[k] > 0).map((k) => {
    const n = summary.byKind[k];
    const [singular, plural] = KIND_LABELS[k];
    return `${n} ${n === 1 ? singular : plural}`;
  });
  const age = summary.oldestAt === null ? "" : ` — oldest ${trashAge(summary.oldestAt, now)}`;
  return `${parts.join(", ")} — ${formatTrashBytes(summary.bytes)}${age}`;
}
