// P3.4 acceptance criterion: "Copyable diagnostic bundle excludes raw/private
// data by default."
//
// The exclusion is the load-bearing half. A researcher pasting this into an
// email or an issue is handing over whatever it contains, and in this app the
// sensitive material is not credentials — it is the science: unpublished
// sample names, column labels naming a collaborator's compound, absolute paths
// exposing a project directory, and the measurements themselves. So the tests
// below feed a snapshot stuffed with exactly those and assert none of it
// survives, rather than only asserting the useful fields are present.

import { describe, expect, it } from "vitest";

import { buildDiagnostics, type DiagnosticsSnapshot } from "./diagnostics";

const SECRETS = {
  datasetName: "UNPUBLISHED-LaSrMnO3-batch7",
  columnLabel: "Moment_collabSecret",
  path: "C:\\Users\\paige\\Projects\\embargoed\\run7.dat",
  value: 1234.56789,
  note: "do not share before the paper lands",
};

const SNAP: DiagnosticsSnapshot = {
  takenAt: "2026-08-29T18:00:00.000Z",
  platform: { userAgent: "Mozilla/5.0 (X11; Linux x86_64)", language: "en-GB", desktop: true },
  display: { width: 2560, height: 1440, devicePixelRatio: 2 },
  environment: {
    theme: "dark",
    density: "compact",
    reduceMotionPref: false,
    reduceMotionOS: true,
    accent: "teal",
  },
  workspace: {
    datasets: 12,
    workbooks: 3,
    folders: 5,
    figures: 2,
    openWindows: 4,
    largestDatasetRows: 1_000_000,
    largestDatasetColumns: 7,
    datasetsWithFormulas: 4,
    datasetsWithCorrections: 2,
    datasetsWithErrorRoles: 1,
    stageTab: "plot",
  },
  storage: [
    { key: "qz.calcHistory", bytes: 4096 },
    { key: "qz.prefs", bytes: 512 },
  ],
};

describe("diagnostics bundle — redaction", () => {
  const text = buildDiagnostics(SNAP);

  it("contains no dataset name, column label, path, value or note", () => {
    for (const [what, secret] of Object.entries(SECRETS)) {
      expect(text, `${what} must never reach the bundle`).not.toContain(String(secret));
    }
  });

  it("carries no absolute filesystem paths", () => {
    expect(text).not.toMatch(/[A-Za-z]:\\/); // Windows
    expect(text).not.toMatch(/\/(?:home|Users)\//); // POSIX
  });

  it("reports storage slots by key and size only, never contents", () => {
    expect(text).toContain("qz.calcHistory");
    expect(text).toContain("4096");
    // The shape is "key (bytes)" — no value column exists to leak into.
    expect(text).not.toMatch(/qz\.calcHistory\s*[:=]\s*\{/);
  });
});

describe("diagnostics bundle — usefulness", () => {
  const text = buildDiagnostics(SNAP);

  it("reports the environment a bug report actually needs", () => {
    expect(text).toContain("2560×1440");
    expect(text).toContain("2"); // devicePixelRatio — the high-DPI bullet
    expect(text).toContain("dark");
    expect(text).toContain("compact");
    expect(text).toContain("en-GB");
  });

  it("distinguishes the OS reduce-motion setting from the app preference", () => {
    // These are independently settable (see styles/index.css), and a motion
    // complaint is unreadable without knowing which one was on.
    expect(text).toMatch(/reduce motion.*OS/i);
    expect(text).toMatch(/reduce motion.*pref/i);
  });

  it("describes workspace SHAPE without naming anything in it", () => {
    expect(text).toContain("12"); // dataset count
    expect(text).toContain("1000000"); // largest rows, for perf reports
    expect(text).toContain("desktop");
  });

  it("is stable and copy-pasteable plain text", () => {
    expect(buildDiagnostics(SNAP)).toBe(text);
    expect(text.split("\n").length).toBeGreaterThan(5);
    expect(text).not.toContain("[object Object]");
    expect(text).not.toContain("undefined");
  });
});
