import { describe, expect, it, vi } from "vitest";

import { originImportNotice, TRUNCATED_NOTICE_TTL } from "./originImportNotice";
import type { OriginFidelityManifest } from "./types";

const manifest = (extra: Partial<OriginFidelityManifest> = {}): OriginFidelityManifest => ({
  version: 1, container: "opju", status: "best_effort",
  graph_records_total: 2, graph_records_actionable: 1, graph_records_filtered: 0,
  omissions: [], filtered_figures: [], ...extra,
});
const worksheet = {
  version: 1 as const, status: "partial" as const, columns_imported: 3, unverified_columns: 0,
  losses: [{ code: "columns_not_decoded", count: 2, examples: ["Book1_C"] }],
};

describe("originImportNotice — the merged .opj/.opju import toast", () => {
  it("a truncated file leads over worksheet losses, long-lived, with the details action", () => {
    const show = vi.fn();
    const note = originImportNotice("P", manifest({ omissions: ["file_truncated"], worksheet }), show);
    expect(note.msg).toMatch(/^P: the file appears incomplete or truncated/);
    expect(note.opts?.ttlMs).toBe(TRUNCATED_NOTICE_TTL);
    note.opts?.action?.onClick();
    expect(show).toHaveBeenCalledOnce();
  });

  it("worksheet losses are a danger with the action; a clean import is info with no options", () => {
    const lost = originImportNotice("P", manifest({ worksheet }), vi.fn());
    expect(lost).toMatchObject({ kind: "danger", msg: "P: 2 worksheet items could not be imported. 1/2 Origin graph records are editable" });
    expect(lost.opts?.action?.label).toBe("Show what is missing");
    const clean = originImportNotice("P", manifest());
    expect(clean).toEqual({ msg: "P: 1/2 Origin graph records are editable; fidelity details saved", kind: "info" });
  });
});
