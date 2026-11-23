// Result-lifecycle guard (plans/RESULT_ACCEPTANCE_AUDIT.md): a workshop that adds
// an analysis output worksheet must go through the shared commit contract
// (store/analysisOutputCommit.ts: one undo step, no duplicate, recorded inputs,
// stale marking) or addDatasetsOneStep. A raw `addDataset(` in a workshop is
// allowed only for the files below, each with the reason it is not an analysis
// writer. The list may only SHRINK: a stale entry fails too.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");

const ALLOWED_RAW_WRITERS: Record<string, string> = {
  "database/SqliteQueryDialog.tsx": "import of a query result: no source worksheet",
  "digitizer/useDigitizer.ts": "digitizes an image (no source worksheet); repeat-click guarded by its own key",
  "importwizard/useImportWizard.ts": "file import: the raw data itself",
  "pipeline/runTemplate.ts": "pipeline replay: each run is a recorded step, outputs are recorded macros",
  "pipeline/useTemplates.ts": "template import / replay onto a fresh file",
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("raw addDataset in workshops", () => {
  const offenders = sources(ROOT)
    .filter((file) => /\baddDataset\(/.test(readFileSync(file, "utf8")))
    .map((file) => relative(ROOT, file).split("\\").join("/"))
    .sort();

  it("only the audited non-analysis writers add a worksheet outside the commit contract", () => {
    expect(offenders.filter((file) => !(file in ALLOWED_RAW_WRITERS))).toEqual([]);
  });

  it("the allowlist holds no entry that no longer writes raw (ratchet down)", () => {
    expect(Object.keys(ALLOWED_RAW_WRITERS).filter((file) => !offenders.includes(file))).toEqual([]);
  });
});
