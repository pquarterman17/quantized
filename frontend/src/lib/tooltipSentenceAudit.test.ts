// PRIMARY_SOFTWARE_AUDIT_PLAN — "Progressive disclosure; tooltips remain one
// sentence." Script-free: this test itself walks frontend/src and scans
// tooltip string literals, rather than a one-off node script whose output
// could go stale unnoticed. It covers the two literal patterns the audit
// item names — `title="..."` (native tooltips) and `hint: "..."` (the
// `{ key, label, hint }` form-field-hint convention used throughout the
// Library/export/report/plot-command dialogs) — plus `description: "..."`
// inside the command registry (`commands/*.ts`, `store/commands.ts`), which
// this plan's own line 5401 already calls "the one-sentence tooltip" (its
// existing `helpContent.test.ts` guard only enforces a MINIMUM length; this
// is the missing MAXIMUM-shape check, "at most one sentence").
//
// "One sentence" is enforced structurally, not by a strict grammar: a
// terminator (`.`/`!`/`?`) is fine at the very end, and semicolons, dashes,
// colons, and parentheticals joining clauses are fine anywhere (this
// codebase's existing hints lean on exactly that style, e.g. "PDF / SVG are
// vector; PNG / TIFF are raster") — what is flagged is a terminator
// FOLLOWED BY MORE TEXT, i.e. two or more actual sentences in one tooltip.
//
// Sabotage-verifiable: add `title="One sentence. And then another."` to any
// non-allowlisted component and this fails.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Directories that are never source-scanned.
const SKIP_DIR_NAMES = new Set(["__fixtures__", "node_modules"]);

// ---------------------------------------------------------------------------
// Explicit, commented allowlist. These paths (files or whole directories,
// relative to frontend/src) are under active edit by OTHER open PRs at the
// time this audit was added (2026-09-28) — touching them here would create
// merge conflicts with unrelated work, so any tooltip issue in them is
// deliberately left for a later sweep instead of fixed in this change.
// -----------------------------------------------------------------------
const ALLOWLIST_PATHS = [
  "components/Stage/Stage.tsx",
  // Not present as its own file at the commit this audit was written against
  // (grepped for "EmptyProjectStage"/"EmptyProject" across frontend/src and
  // found nothing) — named here anyway so the guard exempts it the moment
  // the other PR lands it, rather than someone having to remember to add it.
  "components/EmptyProjectStage.tsx",
  "components/Stage/EmptyProjectStage.tsx",
  // "the legend components"
  "components/Stage/PlotLegend.tsx",
  "components/Stage/LegendSample.tsx",
  "components/Stage/SpatialPanelLegend.tsx",
  // "Library components (components/Library/*)" — the whole directory.
  "components/Library/",
  "commands/fileCommands.ts",
  "store/projectLock.ts",
  "lib/openWorkspaceReplace.ts",
  "lib/sendFigureToReport.ts",
  "components/workshops/recipemanager/RecipeManagerPanel.tsx",
];

function isAllowlisted(relPath: string): boolean {
  return ALLOWLIST_PATHS.some((entry) =>
    entry.endsWith("/") ? relPath.startsWith(entry) : relPath === entry,
  );
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR_NAMES.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if ([".ts", ".tsx"].includes(extname(name)) && !name.includes(".test.")) out.push(full);
  }
}

/** Flags two-or-more sentences: a terminator followed by whitespace and
 *  another capital letter or "(" — NOT a terminator at the very end, and NOT
 *  a semicolon/colon/dash/comma joining two clauses (this codebase's normal
 *  one-sentence style for a compound tooltip). */
function isMultiSentence(text: string): boolean {
  const body = text.trim().replace(/[.!?]$/, "");
  return /[.!?]\s+[A-Z(]/.test(body);
}

interface Hit {
  file: string;
  kind: string;
  text: string;
}

const PATTERNS: { kind: string; re: RegExp; restrictTo?: (relPath: string) => boolean }[] = [
  { kind: "title=", re: /\btitle="([^"]+)"/g },
  { kind: "hint:", re: /\bhint:\s*"([^"]+)"/g },
  { kind: "hint:", re: /\bhint:\s*'([^']+)'/g },
  {
    kind: "description:",
    re: /\bdescription:\s*"([^"]+)"/g,
    // "the existing help/tooltip registry" (PRIMARY_SOFTWARE_AUDIT_PLAN
    // line ~5401): store/commands.ts's `Action.description` and the
    // commands/*.ts files that build its entries. Restricted to those —
    // NOT a blanket scan — because `description:` is also an ordinary
    // object-literal field name with no tooltip meaning elsewhere in the
    // tree (API schemas, test fixtures, etc.).
    restrictTo: (relPath) => relPath === "store/commands.ts" || relPath.startsWith("commands/"),
  },
];

function scan(): { hits: Hit[]; scanned: number; filesScanned: number } {
  const files: string[] = [];
  walk(SRC_ROOT, files);
  const hits: Hit[] = [];
  let scanned = 0;
  let filesScanned = 0;
  for (const file of files) {
    const relPath = relative(SRC_ROOT, file).split("\\").join("/"); // posix-normalize for Windows CI
    if (isAllowlisted(relPath)) continue;
    filesScanned++;
    const src = readFileSync(file, "utf8");
    for (const { kind, re, restrictTo } of PATTERNS) {
      if (restrictTo && !restrictTo(relPath)) continue;
      const pattern = new RegExp(re.source, re.flags);
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(src))) {
        const text = m[1];
        if (text.length < 15) continue; // too short to be a real sentence-count concern
        scanned++;
        if (isMultiSentence(text)) hits.push({ file: relPath, kind, text });
      }
    }
  }
  return { hits, scanned, filesScanned };
}

describe("tooltip strings stay one sentence (progressive disclosure)", () => {
  it("scans a non-trivial number of files and candidate strings (sanity)", () => {
    const { scanned, filesScanned } = scan();
    expect(filesScanned).toBeGreaterThan(100);
    expect(scanned).toBeGreaterThan(50);
  });

  it("flags no title=/hint:/registry description longer than one sentence", () => {
    const { hits } = scan();
    const report = hits.map((h) => `${h.file} [${h.kind}] ${JSON.stringify(h.text)}`).join("\n");
    expect(hits, `multi-sentence tooltip(s) found:\n${report}`).toEqual([]);
  });

  it("the allowlist only names paths that exist or are explicitly future-facing", () => {
    // Keeps the allowlist itself honest: every entry either exists on disk
    // today, or is one of the two documented "not landed yet" guesses for
    // EmptyProjectStage (see the comment above ALLOWLIST_PATHS).
    const files: string[] = [];
    walk(SRC_ROOT, files);
    const relPaths = new Set(files.map((f) => relative(SRC_ROOT, f).split("\\").join("/")));
    const dirPrefixes = ALLOWLIST_PATHS.filter((p) => p.endsWith("/"));
    const filePaths = ALLOWLIST_PATHS.filter((p) => !p.endsWith("/"));
    const knownFuture = new Set(["components/EmptyProjectStage.tsx", "components/Stage/EmptyProjectStage.tsx"]);
    for (const p of filePaths) {
      if (knownFuture.has(p)) continue;
      expect(relPaths.has(p), `allowlisted file ${p} does not exist — check it wasn't renamed`).toBe(true);
    }
    for (const prefix of dirPrefixes) {
      expect(
        [...relPaths].some((p) => p.startsWith(prefix)),
        `allowlisted directory ${prefix} matches no file — check it wasn't renamed`,
      ).toBe(true);
    }
  });
});
