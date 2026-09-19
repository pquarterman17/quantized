// Characterization tests for the MACRO RECORDER + PIPELINE domain (audit
// P4.1 — "characterization tests first" before a god-module decomposition,
// the FIFTH domain). The domain: `startMacro`/`stopMacro`/`clearMacro`/
// `recordMacro` (the recorder — curated call sites throughout the store
// invoke `recordMacro` unconditionally; the gate on whether it actually
// appends a step lives HERE) and `updateStepParams`/`toggleStep`/
// `removeStep`/`moveStep`/`insertStep`/`loadSteps`/`setPipelineRunning` (the
// editable pipeline view, #6, over the SAME `macroSteps` list the recorder
// fills). Three state fields: `macroRecording`, `macroSteps`,
// `pipelineRunning`.
//
// Cohesion, confirmed by grep across store/*.ts before the move: nothing
// outside this cluster WRITES `macroRecording`/`macroSteps`/`pipelineRunning`
// except `store/workspaceHydration.ts`'s `loadWorkspace` (a bulk `.dwk`
// restore, `ws.macroSteps ?? []` — the same "bulk restores stay outside the
// cluster" shape `plotViewSettings.ts`/`reportsFigureDocs.ts` document for
// their own fields) — this cluster owns every INCREMENTAL action. Unlike
// every earlier P4.1 domain, NONE of these eleven actions call
// `get().recordHistory` or `toast(...)` — macro/pipeline edits are not part
// of the undo stack (history.ts's own exclusion list) and never toast, so
// there is no undo-label/toast half to this file the way there is for
// plotViewSettings.characterization.test.ts or
// viewAppliers.characterization.test.ts.
//
// What each spec pins, per action and per BRANCH:
//   the EXACT set of top-level store keys the call changes — a whole
//   `getState()` snapshot diffed by IDENTITY (`!==`), matching every earlier
//   P4.1 characterization file. Because every array-returning branch here
//   (`.map`/`.filter`/spread) constructs a NEW array even when its CONTENT is
//   unchanged (an unmatched id, a clamped move that lands back where it
//   started), `macroSteps` shows as "changed" in those cases too — that is
//   pinned deliberately below, not overlooked, and is the exact place a
//   short-circuit ("nothing matched, skip the set() entirely") would go
//   unnoticed without this file: `moveStep`'s "id not found" branch is the
//   one genuine short-circuit (a literal `{}`, no field written at all) and
//   is pinned as an EMPTY changed set to tell the two apart.
//
// `macroRecording`/`pipelineRunning` are plain booleans set to a HARDCODED
// target by several actions (`startMacro` always writes `true`,
// `clearMacro` always writes `false`) — poisoning them to a single
// store-wide non-default value would make half of those writes invisible
// (same value in, same value out, no identity change on a primitive), so
// each spec below arranges its OWN starting value for whichever boolean the
// action under test targets, and a dedicated pair of specs pins the
// "already at the target value" case as a DELIBERATE empty diff for that
// field — real, not a gap. `macroSteps` has real content-bearing poisoning
// (a `poison()` seed) since every branch that touches it produces an
// observable content difference.
//
// Nothing in this file may change when the cluster moves out of
// store/useApp.ts except the module it imports (it imports only `./useApp`,
// so in the event: nothing at all).
//
// Deliberately NOT a duplicate of store/useApp.test.ts's macro/pipeline
// spread (recordMacro's `qz.*` script generation via real store call sites,
// clearMacro's pause interaction) — that file covers a handful of real call
// sites; this one covers the eleven actions THEMSELVES, exhaustively,
// against the whole-state complement.

import { beforeEach, describe, expect, it } from "vitest";

import type { PipelineStep, StepKind } from "../lib/pipeline";
import { useApp } from "./useApp";

// ── fixtures ────────────────────────────────────────────────────────────────

function step(
  id: string,
  kind: StepKind,
  label: string,
  code: string,
  params: Record<string, unknown> = {},
  enabled = true,
): PipelineStep {
  return { id, kind, label, code, params, enabled };
}

// ── harness ─────────────────────────────────────────────────────────────────

type Snap = Record<string, unknown>;

const snapshot = (): Snap => ({ ...(useApp.getState() as unknown as Snap) });

/** Top-level store keys whose value changed identity, sorted. */
function changedSince(before: Snap): string[] {
  const after = useApp.getState() as unknown as Snap;
  return Object.keys(after)
    .filter((k) => after[k] !== before[k])
    .sort();
}

/** POISON: seed macroSteps with content a real call would never coincidentally
 *  reproduce, so any branch that touches the array is observably different —
 *  including a branch that leaves its CONTENT the same but the array itself a
 *  new reference (still "changed" by the identity rule above, pinned as such).
 *  `macroRecording`/`pipelineRunning` are seeded NON-default too — the seven
 *  pipeline-view actions (updateStepParams/toggleStep/removeStep/moveStep/
 *  insertStep/loadSteps/setPipelineRunning) never read or write
 *  `macroRecording`, but their "writes ONLY macroSteps" specs diff the WHOLE
 *  store, so an accidental `macroRecording` write in a future edit must be
 *  observable no matter which order the file's describe blocks run in —
 *  relying on carryover from an earlier describe block (the recorder specs
 *  leaving it `true`) made that coverage order-dependent and silently absent
 *  under `vitest run -t` on any of the seven in isolation (default `false`,
 *  unpoisoned). `startMacro`/`stopMacro`/`recordMacro`/`clearMacro` still
 *  arrange their OWN starting value per spec (a hardcoded-target boolean
 *  poisoned to its own target is invisible either way — see the file header),
 *  so this global seed only matters for the seven that must leave it alone. */
function poison(): void {
  useApp.setState({
    macroSteps: [step("stale-1", "ui", "STALE", "stale();")],
    macroRecording: true, // non-default (false)
    pipelineRunning: true, // non-default (false); recordMacro specs override per-branch
  });
}

beforeEach(() => {
  poison();
});

// ── startMacro / stopMacro ───────────────────────────────────────────────────

describe("startMacro", () => {
  it("sets macroRecording true and writes ONLY that field", () => {
    useApp.setState({ macroRecording: false }); // arrange: starting OFF makes the flip observable
    const before = snapshot();
    useApp.getState().startMacro();
    expect(changedSince(before)).toEqual(["macroRecording"]);
    expect(useApp.getState().macroRecording).toBe(true);
  });

  it("already recording: writes the same value — no observable diff (real, not a gap)", () => {
    useApp.setState({ macroRecording: true });
    const before = snapshot();
    useApp.getState().startMacro();
    expect(changedSince(before)).toEqual([]);
  });
});

describe("stopMacro", () => {
  it("sets macroRecording false and writes ONLY that field", () => {
    useApp.setState({ macroRecording: true });
    const before = snapshot();
    useApp.getState().stopMacro();
    expect(changedSince(before)).toEqual(["macroRecording"]);
    expect(useApp.getState().macroRecording).toBe(false);
  });

  it("already stopped: writes the same value — no observable diff", () => {
    useApp.setState({ macroRecording: false });
    const before = snapshot();
    useApp.getState().stopMacro();
    expect(changedSince(before)).toEqual([]);
  });
});

// ── clearMacro ────────────────────────────────────────────────────────────

describe("clearMacro", () => {
  it("empties macroSteps AND stops recording, unconditionally", () => {
    useApp.setState({
      macroRecording: true,
      macroSteps: [step("s1", "ui", "one", "qz.one();")],
    });
    const before = snapshot();
    useApp.getState().clearMacro();
    expect(changedSince(before)).toEqual(["macroRecording", "macroSteps"]);
    expect(useApp.getState().macroSteps).toEqual([]);
    expect(useApp.getState().macroRecording).toBe(false);
  });

  it("already idle and empty: macroSteps still shows changed (new [] reference); macroRecording does not", () => {
    useApp.setState({ macroRecording: false, macroSteps: [] });
    const before = snapshot();
    useApp.getState().clearMacro();
    expect(changedSince(before)).toEqual(["macroSteps"]);
  });
});

// ── recordMacro (the gate) ──────────────────────────────────────────────────

describe("recordMacro", () => {
  it("recording on, pipeline not running: appends a typed step and writes ONLY macroSteps", () => {
    useApp.setState({ macroRecording: true, pipelineRunning: false, macroSteps: [] });
    const before = snapshot();
    useApp.getState().recordMacro("Facet by ch1", 'qz.facetByColumn("d1", 1)', {
      kind: "expression",
      params: { name: "x" },
    });
    expect(changedSince(before)).toEqual(["macroSteps"]);
    const steps = useApp.getState().macroSteps;
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: "expression",
      label: "Facet by ch1",
      code: 'qz.facetByColumn("d1", 1)',
      params: { name: "x" },
      enabled: true,
    });
    expect(steps[0].id).toMatch(/^step-\d+$/);
  });

  it("no typed arg: defaults to kind \"ui\" and empty params", () => {
    useApp.setState({ macroRecording: true, pipelineRunning: false, macroSteps: [] });
    useApp.getState().recordMacro("Toggle grid", "qz.setShowGrid(true)");
    const [s] = useApp.getState().macroSteps;
    expect(s).toMatchObject({ kind: "ui", params: {} });
  });

  it("appends onto existing steps (doesn't replace the list)", () => {
    useApp.setState({
      macroRecording: true,
      pipelineRunning: false,
      macroSteps: [step("s1", "ui", "first", "qz.first();")],
    });
    useApp.getState().recordMacro("second", "qz.second();");
    expect(useApp.getState().macroSteps.map((s) => s.code)).toEqual([
      "qz.first();",
      "qz.second();",
    ]);
  });

  it("recording OFF: no-op — writes NOTHING, not even macroSteps' reference", () => {
    useApp.setState({ macroRecording: false, pipelineRunning: false });
    const before = snapshot();
    const stepsBefore = useApp.getState().macroSteps;
    useApp.getState().recordMacro("ignored", "qz.ignored();");
    expect(changedSince(before)).toEqual([]);
    expect(useApp.getState().macroSteps).toBe(stepsBefore); // same array identity
  });

  it("recording ON but pipelineRunning true (replay in progress): no-op — the anti-self-recording-loop gate", () => {
    useApp.setState({ macroRecording: true, pipelineRunning: true });
    const before = snapshot();
    const stepsBefore = useApp.getState().macroSteps;
    useApp.getState().recordMacro("ignored", "qz.ignored();");
    expect(changedSince(before)).toEqual([]);
    expect(useApp.getState().macroSteps).toBe(stepsBefore);
  });
});

// ── updateStepParams ─────────────────────────────────────────────────────────

describe("updateStepParams", () => {
  it("a runnable kind (expression) regenerates label + code from the new params", () => {
    useApp.setState({
      macroSteps: [step("s1", "expression", "Add column old", 'qz.addColumn("old", "x")', { name: "old", expr: "x" })],
    });
    const before = snapshot();
    useApp.getState().updateStepParams("s1", { name: "new", expr: "x*2" });
    expect(changedSince(before)).toEqual(["macroSteps"]);
    expect(useApp.getState().macroSteps[0]).toMatchObject({
      label: "Add column new",
      code: 'qz.addColumn("new", "x*2")',
      params: { name: "new", expr: "x*2" },
    });
  });

  it("a non-runnable kind (ui) keeps label/code verbatim but replaces params", () => {
    useApp.setState({
      macroSteps: [step("s1", "ui", "Toggle grid", "qz.setShowGrid(true)", { old: 1 })],
    });
    useApp.getState().updateStepParams("s1", { new: 2 });
    expect(useApp.getState().macroSteps[0]).toMatchObject({
      label: "Toggle grid",
      code: "qz.setShowGrid(true)",
      params: { new: 2 },
    });
  });

  it("an id that matches nothing: content unchanged, but macroSteps still shows changed (new array from .map)", () => {
    const original = [step("s1", "ui", "one", "qz.one();")];
    useApp.setState({ macroSteps: original });
    const before = snapshot();
    useApp.getState().updateStepParams("no-such-id", { x: 1 });
    expect(changedSince(before)).toEqual(["macroSteps"]);
    expect(useApp.getState().macroSteps).toEqual(original);
    expect(useApp.getState().macroSteps).not.toBe(original);
  });
});

// ── toggleStep ────────────────────────────────────────────────────────────

describe("toggleStep", () => {
  it("flips enabled on the matching step and writes ONLY macroSteps", () => {
    useApp.setState({ macroSteps: [step("s1", "ui", "one", "qz.one();", {}, true)] });
    const before = snapshot();
    useApp.getState().toggleStep("s1");
    expect(changedSince(before)).toEqual(["macroSteps"]);
    expect(useApp.getState().macroSteps[0].enabled).toBe(false);
    useApp.getState().toggleStep("s1");
    expect(useApp.getState().macroSteps[0].enabled).toBe(true);
  });

  it("an id that matches nothing: content unchanged, macroSteps still a new reference", () => {
    const original = [step("s1", "ui", "one", "qz.one();")];
    useApp.setState({ macroSteps: original });
    useApp.getState().toggleStep("no-such-id");
    expect(useApp.getState().macroSteps).toEqual(original);
    expect(useApp.getState().macroSteps).not.toBe(original);
  });
});

// ── removeStep ────────────────────────────────────────────────────────────

describe("removeStep", () => {
  it("drops the matching step and writes ONLY macroSteps", () => {
    useApp.setState({
      macroSteps: [step("s1", "ui", "one", "qz.one();"), step("s2", "ui", "two", "qz.two();")],
    });
    const before = snapshot();
    useApp.getState().removeStep("s1");
    expect(changedSince(before)).toEqual(["macroSteps"]);
    expect(useApp.getState().macroSteps.map((s) => s.id)).toEqual(["s2"]);
  });

  it("an id that matches nothing: same length, still a new array reference", () => {
    const original = [step("s1", "ui", "one", "qz.one();")];
    useApp.setState({ macroSteps: original });
    useApp.getState().removeStep("no-such-id");
    expect(useApp.getState().macroSteps).toEqual(original);
    expect(useApp.getState().macroSteps).not.toBe(original);
  });
});

// ── moveStep ──────────────────────────────────────────────────────────────

describe("moveStep", () => {
  it("id not found: a LITERAL no-op — writes NOTHING, not even macroSteps' reference", () => {
    const original = [step("s1", "ui", "one", "qz.one();"), step("s2", "ui", "two", "qz.two();")];
    useApp.setState({ macroSteps: original });
    const before = snapshot();
    useApp.getState().moveStep("no-such-id", 1);
    expect(changedSince(before)).toEqual([]);
    expect(useApp.getState().macroSteps).toBe(original); // same array identity — the one genuine short-circuit
  });

  it("id found, in-bounds move: reorders and writes ONLY macroSteps", () => {
    useApp.setState({
      macroSteps: [step("s1", "ui", "one", "qz.one();"), step("s2", "ui", "two", "qz.two();")],
    });
    const before = snapshot();
    useApp.getState().moveStep("s1", 1);
    expect(changedSince(before)).toEqual(["macroSteps"]);
    expect(useApp.getState().macroSteps.map((s) => s.id)).toEqual(["s2", "s1"]);
  });

  it("id found, delta clamps to the SAME position: still a new array reference (pinned, not a bug)", () => {
    const original = [step("s1", "ui", "one", "qz.one();"), step("s2", "ui", "two", "qz.two();")];
    useApp.setState({ macroSteps: original });
    const before = snapshot();
    useApp.getState().moveStep("s1", -5); // clamps to index 0, already there
    expect(changedSince(before)).toEqual(["macroSteps"]);
    expect(useApp.getState().macroSteps.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(useApp.getState().macroSteps).not.toBe(original);
  });
});

// ── insertStep / loadSteps ──────────────────────────────────────────────────

describe("insertStep", () => {
  it("appends the given step and writes ONLY macroSteps", () => {
    useApp.setState({ macroSteps: [step("s1", "ui", "one", "qz.one();")] });
    const before = snapshot();
    useApp.getState().insertStep(step("s2", "import", "Import", "// import"));
    expect(changedSince(before)).toEqual(["macroSteps"]);
    expect(useApp.getState().macroSteps.map((s) => s.id)).toEqual(["s1", "s2"]);
  });
});

describe("loadSteps", () => {
  it("replaces the whole list and writes ONLY macroSteps", () => {
    useApp.setState({ macroSteps: [step("stale", "ui", "stale", "stale();")] });
    const before = snapshot();
    const fresh = [step("t1", "ui", "loaded", "qz.loaded();")];
    useApp.getState().loadSteps(fresh);
    expect(changedSince(before)).toEqual(["macroSteps"]);
    expect(useApp.getState().macroSteps).toBe(fresh); // set verbatim, not copied
  });

  it("an empty list clears macroSteps", () => {
    useApp.setState({ macroSteps: [step("stale", "ui", "stale", "stale();")] });
    useApp.getState().loadSteps([]);
    expect(useApp.getState().macroSteps).toEqual([]);
  });
});

// ── setPipelineRunning ────────────────────────────────────────────────────

describe("setPipelineRunning", () => {
  it("sets pipelineRunning and writes ONLY that field", () => {
    useApp.setState({ pipelineRunning: false });
    const before = snapshot();
    useApp.getState().setPipelineRunning(true);
    expect(changedSince(before)).toEqual(["pipelineRunning"]);
    expect(useApp.getState().pipelineRunning).toBe(true);
  });

  it("already at the target value: no observable diff", () => {
    useApp.setState({ pipelineRunning: true });
    const before = snapshot();
    useApp.getState().setPipelineRunning(true);
    expect(changedSince(before)).toEqual([]);
  });
});
