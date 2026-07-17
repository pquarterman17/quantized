// Resolve a synthetic fixture file under e2e/fixtures/. NEVER point this at
// ../test-data (the real instrument-file corpus) — this suite is data-format-
// agnostic; it only needs a file the generic delimited-table parser accepts,
// so a small synthetic CSV keeps the suite runnable with no private data.

import path from "node:path";
import { fileURLToPath } from "node:url";

// package.json has "type": "module" — no __dirname global under ESM.
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(here, "..", "fixtures");

export function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}
