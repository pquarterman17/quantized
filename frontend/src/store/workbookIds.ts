// Session-unique workbook id generation (LIBRARY_WORKBOOK_UX_PLAN PR A3/A4).
// Deliberately its OWN module rather than a fourth sibling of
// nextDatasetId/nextFolderId/nextReportId in useApp.ts: the two consumers —
// the import slice (PR A3) and the append path (PR A4) — land as parallel
// branches, and useApp.ts sits at its zero-headroom size ratchet; a shared
// prep module lets both fork without either touching that file. A separate
// counter is fine because uniqueness comes from the time prefix plus the
// monotonic suffix, not from sharing useApp.ts's `_idSeq`.
//
// NOT for .dwk migration ids: parseWorkspace's `wbm-N` counter
// (lib/workspace.ts) must stay deterministic across reopens of the same
// document; this one is deliberately time-seeded for session-lifetime
// uniqueness instead.

let _seq = 0;

/** Fresh session-unique workbook id (`wb-<time36>-<n>`). */
export const nextWorkbookId = (): string => `wb-${Date.now().toString(36)}-${++_seq}`;
