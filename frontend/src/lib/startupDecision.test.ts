// The startup decision (owner decision 2026-11-26): no autosave, autosave + the
// Welcome pref, autosave + the Reopen pref, and crash recovery.

import { beforeEach, describe, expect, it } from "vitest";

import { decideStartup, type StartupInput } from "./startupDecision";
import { WORKFLOW_DEFAULTS, workflowPrefsSlot } from "./workflowPrefs";

const base: StartupInput = { mode: "welcome", hasAutosave: true, crashed: false, contended: false, newerThanLastProject: false };
const decide = (patch: Partial<StartupInput>) => decideStartup({ ...base, ...patch });

describe("decideStartup", () => {
  it("does nothing without an autosave, whatever the pref or crash flag", () => {
    for (const mode of ["welcome", "reopen"] as const) {
      expect(decide({ mode, hasAutosave: false })).toBe("nothing");
      expect(decide({ mode, hasAutosave: false, crashed: true })).toBe("nothing");
    }
  });

  it("autosave + Welcome pref: holds it for the welcome screen, never loads it", () => {
    expect(decide({ mode: "welcome" })).toBe("welcome-offer");
    expect(decide({ mode: "welcome", newerThanLastProject: true })).toBe("welcome-offer"); // no recovery dialog either
  });

  it("autosave + Reopen pref: restores, or asks first when newer than the last named project", () => {
    expect(decide({ mode: "reopen" })).toBe("restore");
    expect(decide({ mode: "reopen", newerThanLastProject: true })).toBe("recovery-dialog");
  });

  it("crash recovery is offered on the welcome screen under either pref", () => {
    expect(decide({ mode: "welcome", crashed: true })).toBe("welcome-offer");
    expect(decide({ mode: "reopen", crashed: true })).toBe("welcome-offer");
    expect(decide({ mode: "reopen", crashed: true, newerThanLastProject: true })).toBe("welcome-offer");
  });

  it("a restore that landed late or over the user's work only prompts (Append / Replace / Discard)", () => {
    for (const mode of ["welcome", "reopen"] as const) expect(decide({ mode, contended: true })).toBe("late-prompt");
  });
});

describe("the On startup pref", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to the welcome screen", () => {
    expect(WORKFLOW_DEFAULTS.onStartup).toBe("welcome");
    expect(workflowPrefsSlot.load().onStartup).toBe("welcome");
  });

  it("keeps Reopen, and reads anything else (a hand-edited slot) as the welcome screen", () => {
    localStorage.setItem("qz.workflowPrefs", JSON.stringify({ onStartup: "reopen" }));
    expect(workflowPrefsSlot.load().onStartup).toBe("reopen");
    for (const bad of ["Reopen", 1, null, "last"]) {
      localStorage.setItem("qz.workflowPrefs", JSON.stringify({ onStartup: bad }));
      expect(workflowPrefsSlot.load().onStartup).toBe("welcome");
    }
  });
});
