// Endpoint-coverage guard: every `/api/...` literal written anywhere in the
// frontend must name a path the backend actually exposes. Catches drift in
// both directions a normal typecheck can't see — a hand-typed path with a
// typo, or a route renamed/removed on the backend whose frontend caller
// wasn't updated — none of which touches a TypeScript type, since every
// wrapper takes `path: string`.
//
// Source of truth: the committed `frontend/api/openapi.json` snapshot (kept
// fresh by tests/test_openapi_snapshot.py on the backend side), read via
// plain node:fs so this test has no import-time dependency on the dev
// server or a running backend.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
// frontend/src/lib/api/ -> frontend/api/openapi.json
const OPENAPI_PATH = join(HERE, "../../../api/openapi.json");
// frontend/src/lib/api/ -> frontend/src/
const SRC_ROOT = join(HERE, "../../");

interface OpenApiDoc {
  paths: Record<string, unknown>;
}

function backendPaths(): string[][] {
  const doc = JSON.parse(readFileSync(OPENAPI_PATH, "utf-8")) as OpenApiDoc;
  return Object.keys(doc.paths).map((p) => p.split("/"));
}

/** One found literal, with its origin for a useful failure message. */
interface Found {
  file: string;
  line: number;
  literal: string;
  text: string;
}

/** Walk `src/`, collecting every non-test `.ts`/`.tsx` file's (path, text). */
function walkSources(dir: string): [string, string][] {
  const out: [string, string][] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkSources(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (/\.test\.(ts|tsx)$/.test(entry)) continue;
    // Generated wholesale by `npm run api:types` (openapi-typescript) — its
    // JSDoc carries dozens of `/api/...` mentions copied verbatim from
    // backend docstrings (e.g. "`/api/stats/correlation`'s `r`"), none of
    // which are calls. It has no fetch of its own to check.
    if (entry === "schema.d.ts") continue;
    out.push([full, readFileSync(full, "utf-8")]);
  }
  return out;
}

/** Drop comment-only lines (same heuristic architecture.test.ts's `code()`
 *  helper uses) so `/api/...` mentions in prose don't read as calls. Doesn't
 *  strip a trailing `// comment` after real code on the same line, but no
 *  current source line needs that — a real literal always leads its line's
 *  code here. */
function codeLines(src: string): [number, string][] {
  return src
    .split("\n")
    .map((line, i): [number, string] => [i + 1, line])
    .filter(([, line]) => {
      const t = line.trim();
      return t !== "" && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    });
}

const QUOTED = /["'](\/api\/[^"']*)["']/g;
const TEMPLATE = /`(\/api\/[^`]*)`/g;

/** Strip a trailing `?query`, and collapse every `${...}` interpolation to a
 *  single `*` wildcard segment (an id, an `encodeURIComponent(...)` call —
 *  always occupies one whole path segment in this codebase). */
function normalize(literal: string): string {
  return literal.split("?")[0].replace(/\$\{[^}]*\}/g, "*");
}

function findLiterals(): Found[] {
  const found: Found[] = [];
  for (const [file, src] of walkSources(SRC_ROOT)) {
    for (const [line, text] of codeLines(src)) {
      for (const re of [QUOTED, TEMPLATE]) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          found.push({ file, line, literal: normalize(m[1]), text });
        }
      }
    }
  }
  return found;
}

/** A literal path segment matches a backend segment if either is a
 *  wildcard (our `*` from a stripped interpolation, or the OpenAPI
 *  `{param}` convention), or they're textually identical. */
function segmentMatches(litSeg: string, apiSeg: string): boolean {
  if (litSeg.includes("*")) return true;
  if (apiSeg.startsWith("{") && apiSeg.endsWith("}")) return true;
  return litSeg === apiSeg;
}

function matchesSomeBackendPath(literal: string, backend: string[][]): boolean {
  const litSegs = literal.split("/");
  return backend.some(
    (apiSegs) => apiSegs.length === litSegs.length && apiSegs.every((a, i) => segmentMatches(litSegs[i], a)),
  );
}

// Literals that are real `/api/...`-shaped strings in source but are NOT
// endpoint calls, investigated individually (RSM: JMP_GAP-style coverage
// audit). Each entry needs a one-line, honest reason — no blanket excuses.
const ALLOWLIST: Record<string, string> = {
  // `path.startsWith("/api/rsm/")` — a PREFIX test deciding whether a POST
  // body is dataset-cache-eligible, not a path fetched anywhere itself.
  "/api/rsm/": "prefix test in isDatasetCachePath, not a fetch target",
  // `recommend.endpoint.replace("/api/stats/", "")` — stripping a prefix off
  // a label the backend already returned, for display only.
  "/api/stats/": "display-string prefix strip, not a fetch target",
};

describe("every /api/ literal in src names a real backend path (openapi.json)", () => {
  const backend = backendPaths();

  it("finds a nonzero number of literals and backend paths (guard would silently pass empty)", () => {
    expect(backend.length).toBeGreaterThan(50);
    expect(findLiterals().length).toBeGreaterThan(50);
  });

  it("every literal either matches a backend path or is on the allowlist", () => {
    const misses = findLiterals()
      .filter((f) => !ALLOWLIST[f.literal])
      .filter((f) => !matchesSomeBackendPath(f.literal, backend))
      .map((f) => `${f.file}:${f.line}: ${f.literal}`);
    expect(
      misses,
      "a literal here names no backend route — fix the typo/stale path, or add it to " +
        "ALLOWLIST above with a one-line honest reason if it isn't really a fetch target",
    ).toEqual([]);
  });

  it("the allowlist stays honest — every entry is still actually unmatched and still appears in src", () => {
    const literalsInSrc = new Set(findLiterals().map((f) => f.literal));
    const stale = Object.keys(ALLOWLIST).filter(
      (lit) => !literalsInSrc.has(lit) || matchesSomeBackendPath(lit, backend),
    );
    expect(stale, "remove from ALLOWLIST: no longer present in src, or now matches a real backend path").toEqual(
      [],
    );
  });

  it("no allowlisted literal is a request target", () => {
    // The allowlist above may only excuse a literal that is genuinely NOT a
    // fetch target (a prefix test, a display-string strip). If an
    // allowlisted literal's line is itself a request call, that's not an
    // excused non-call — it's a dead fetch (or worse, a live one drifted
    // from the backend) that must be fixed, not papered over here.
    // Anchored on the literal itself (not just "a request call somewhere on
    // the line"), so a line that passes an allowlisted prefix as a body field
    // of an unrelated request is not a false positive.
    const requestOf = (literal: string): RegExp =>
      new RegExp(
        String.raw`\b(fetch|getJSON|postJSON|deleteJSON|postForm|postBlob|postDownload|postApi)\s*\(\s*["'\x60]` +
          literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      );
    const offenders = findLiterals()
      .filter((f) => ALLOWLIST[f.literal])
      .filter((f) => requestOf(f.literal).test(f.text))
      .map((f) => `${f.file}:${f.line}: ${f.literal}`);
    expect(
      offenders,
      "an allowlisted literal is the path argument of a request call — the allowlist may only " +
        "excuse non-fetch uses (prefix tests, display strings); a dead fetch must be fixed, not listed",
    ).toEqual([]);
  });
});
