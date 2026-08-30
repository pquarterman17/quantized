// The assertions that would have caught #269's Windows defect.
//
// The original build-identity test asserted only `toBeTruthy()` on the SHA.
// That is satisfied by the string "unknown", which is precisely what a Windows
// build produced once `gitSha()`'s `cwd` came back as the URL pathname
// `/C:/Users/…` and Node rejected it with ENOENT. The fallback was doing its
// job; the test simply could not tell the difference between a real stamp and
// a silent failure. So these pin the SHAPE of the values, not their mere
// existence.
//
// COVERAGE LIMIT, stated plainly: both frontend CI jobs run ubuntu-latest, so
// nothing here executes on Windows. These bind to the real `define` output and
// would have caught the defect for anyone running the suite on Windows (which
// is how review found it); the grep guard in architecture.test.ts is what
// actually holds the line on Linux CI. Closing the gap properly needs a
// Windows frontend job, which is a CI-cost decision for the repo owner.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { APP_VERSION, BUILD_SHA } from "./buildInfo";

/** Walk up from the runner's cwd to the directory holding `package.json`.
 *  Not `fileURLToPath(import.meta.url)`: under vitest a test module's URL
 *  comes from vite's module graph and is not a `file:` URL at all, so that
 *  throws "The URL must be of scheme file" at collection time. */
function findUp(marker: string): string {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(join(dir, marker))) return dir;
    const up = dirname(dir);
    if (up === dir) throw new Error(`no ${marker} above ${process.cwd()}`);
    dir = up;
  }
}

const frontendDir = findUp("package.json");
const repoRoot = resolve(frontendDir, "..");

describe("build identity injected by vite define", () => {
  it("reports the real package version, not the 'dev' fallback", () => {
    const pkg = JSON.parse(readFileSync(join(frontendDir, "package.json"), "utf8")) as {
      version: string;
    };
    expect(APP_VERSION).toBe(pkg.version);
    expect(APP_VERSION).not.toBe("dev");
  });

  it("reports a real commit SHA, not the 'unknown' fallback", () => {
    if (!existsSync(join(repoRoot, ".git"))) {
      // A vendored tree or an sdist genuinely has no SHA to report; the
      // fallback is correct there and asserting against it would be wrong.
      expect(BUILD_SHA).toBe("unknown");
      return;
    }
    expect(BUILD_SHA).not.toBe("unknown");
    expect(BUILD_SHA).toMatch(/^[0-9a-f]{7,40}$/);
  });

  it("stamps the commit this tree is actually on", () => {
    if (!existsSync(join(repoRoot, ".git"))) return;
    const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    expect(BUILD_SHA).toBe(head);
  });
});
