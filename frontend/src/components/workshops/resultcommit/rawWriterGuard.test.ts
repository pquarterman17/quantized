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

// Comments are stripped and the bare identifier is matched (not `addDataset(`), so
// `const add = useApp((s) => s.addDataset)` and `addWorksheetQuietly(...)` cannot
// slip past. `addDatasetsOneStep` is a different identifier and is the allowed route.
const RAW_WRITER = /\baddDataset\b|\baddWorksheetQuietly\b/;
const stripComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("raw addDataset in workshops", () => {
  const offenders = sources(ROOT)
    .filter((file) => RAW_WRITER.test(stripComments(readFileSync(file, "utf8"))))
    .map((file) => relative(ROOT, file).split("\\").join("/"))
    .sort();

  it("only the audited non-analysis writers add a worksheet outside the commit contract", () => {
    expect(offenders.filter((file) => !(file in ALLOWED_RAW_WRITERS))).toEqual([]);
  });

  it("the matcher sees the shapes a bypass would use", () => {
    expect(RAW_WRITER.test("const add = useApp((s) => s.addDataset);")).toBe(true);
    expect(RAW_WRITER.test("addWorksheetQuietly(ds, 'x')")).toBe(true);
    expect(RAW_WRITER.test(stripComments("// addDataset( in a comment\n/* addDataset */"))).toBe(false);
    expect(RAW_WRITER.test("addDatasetsOneStep('x', [])")).toBe(false);
  });

  it("every allowlist entry carries a reason", () => {
    for (const [file, reason] of Object.entries(ALLOWED_RAW_WRITERS)) expect(reason.length, file).toBeGreaterThan(15);
  });

  it("the allowlist holds no entry that no longer writes raw (ratchet down)", () => {
    expect(Object.keys(ALLOWED_RAW_WRITERS).filter((file) => !offenders.includes(file))).toEqual([]);
  });
});
