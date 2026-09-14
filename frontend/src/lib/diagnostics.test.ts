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

import {
  buildDiagnostics,
  DIAGNOSTICS_SCHEMA_VERSION,
  type DiagnosticsSnapshot,
} from "./diagnostics";

const SECRETS = {
  datasetName: "UNPUBLISHED-LaSrMnO3-batch7",
  columnLabel: "Moment_collabSecret",
  path: "C:\\Users\\paige\\Projects\\embargoed\\run7.dat",
  value: 1234.56789,
  note: "do not share before the paper lands",
};

const SNAP: DiagnosticsSnapshot = {
  takenAt: "2026-08-29T18:00:00.000Z",
  build: { version: "0.23.2", sha: "abc1234" },
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
  otherStorage: { slots: 0, bytes: 0 },
  backend: { reachable: true, app: "quantized", version: "0.23.2" },
  session: {
    lastAutosaveAgeSec: 12,
    autosaveFailing: false,
    autosaveGenerations: 3,
    recoveryPromptOpen: false,
    pendingOps: 1,
    notifications: { total: 9, errors: 2, lastErrorAgeSec: 41 },
  },
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

  it("names the build that produced it", () => {
    // "0.23.2" alone cannot tell a release tag from eleven commits past it,
    // and the first question asked of any bug report is which build it is.
    expect(text).toContain("0.23.2");
    expect(text).toContain("abc1234");
  });

  it("stamps the report schema so a later layout change is detectable", () => {
    expect(text).toContain(`report schema  ${String(DIAGNOSTICS_SCHEMA_VERSION)}`);
  });

  it("renders a completely empty slot list without NaN padding", () => {
    // The old "(none)" row existed to stop `Math.max()` of an empty array
    // returning -Infinity and poisoning `padEnd`. The always-present
    // unrecognised row makes that structurally impossible now — but only as
    // long as it IS always present, which is what this pins.
    const empty = buildDiagnostics({ ...SNAP, storage: [], otherStorage: { slots: 0, bytes: 0 } });
    expect(empty).not.toContain("NaN");
    expect(empty).not.toContain("Infinity");
    expect(empty).toContain("(unrecognised)");
  });

  it("reports unrecognised slots even when there are none", () => {
    // An omitted line is indistinguishable from a report built before this
    // section existed, which is the reading that matters when triaging one.
    expect(text).toContain("(unrecognised)");
    expect(text).toContain("0 slots, 0 bytes");
  });

  it("summarises unrecognised slots without a name when some exist", () => {
    const withOther = buildDiagnostics({
      ...SNAP,
      otherStorage: { slots: 3, bytes: 8192 },
    });
    expect(withOther).toContain("3 slots, 8192 bytes");
  });

  it("names the backend that answered, so a version mismatch is visible", () => {
    // A desktop launch pairs a bundled SPA with a bundled backend; when the
    // two disagree the symptom ("the button does nothing") names neither.
    expect(text).toMatch(/backend\s+quantized 0\.23\.2/);
  });

  it("strips control characters from the echoed backend identity (P3.4 review round, nit 7)", () => {
    // `app`/`version` are server-generated constants for the real backend,
    // but the fetch is same-origin-relative — whatever process answers
    // /api/health controls these two strings. Pasted verbatim with no clamp,
    // a value containing a newline could break this report's column layout
    // or forge a section heading; this asserts it cannot.
    const hostile = buildDiagnostics({
      ...SNAP,
      backend: { reachable: true, app: "quantized\n## Session health", version: "1\t0\r0" },
    });
    // The injected control characters became single spaces — the "backend"
    // row stays exactly one line, and no raw tab or carriage return survives
    // anywhere in the report.
    expect(hostile).toMatch(/^backend\s+quantized ## Session health 1 0 0$/m);
    expect(hostile).not.toContain("\t");
    expect(hostile).not.toContain("\r");
    // Same total line count as the well-behaved baseline report: an
    // unsanitized embedded "\n" would have split the backend row into an
    // EXTRA line, growing the count and letting the injected text land at
    // the start of its own line rather than inside the "backend" value.
    expect(hostile.split("\n")).toHaveLength(text.split("\n").length);
  });

  it("says so plainly when no backend answered", () => {
    const offline = buildDiagnostics({ ...SNAP, backend: { reachable: false, app: null, version: null } });
    expect(offline).toMatch(/backend\s+unreachable/);
    // Never "null"/"undefined" dressed up as a version.
    expect(offline).not.toContain("null");
  });

  it("reports session health as states, counts and ages", () => {
    expect(text).toMatch(/autosave\s+ok/);
    expect(text).toMatch(/last autosave\s+12 s ago/);
    expect(text).toMatch(/generations kept\s+3/);
    expect(text).toMatch(/operations in flight\s+1/);
    expect(text).toMatch(/notifications\s+9/);
    expect(text).toMatch(/of those, errors\s+2/);
    expect(text).toMatch(/last error\s+41 s ago/);
  });

  it("shouts when autosave is failing, since that changes how a report reads", () => {
    const failing = buildDiagnostics({
      ...SNAP,
      session: { ...SNAP.session, autosaveFailing: true, lastAutosaveAgeSec: null },
    });
    expect(failing).toMatch(/autosave\s+FAILING/);
    // "never" rather than an age nobody can interpret, and no NaN from the
    // arithmetic that would otherwise run on a null.
    expect(failing).toMatch(/last autosave\s+never/);
    expect(failing).not.toContain("NaN");
  });

  it("is stable and copy-pasteable plain text", () => {
    expect(buildDiagnostics(SNAP)).toBe(text);
    expect(text.split("\n").length).toBeGreaterThan(5);
    expect(text).not.toContain("[object Object]");
    expect(text).not.toContain("undefined");
  });
});
