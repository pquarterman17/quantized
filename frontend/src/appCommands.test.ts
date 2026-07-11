// Direct behavioral test for the "Cycle X/Y tick format" commands (MAIN
// #20) — buildAppActions is curated against the REAL store (StoreGet =
// typeof useApp.getState), so a command can be found by id and run() against
// the live store without mounting the App tree.

import { beforeEach, describe, expect, it } from "vitest";

import { buildAppActions } from "./appCommands";
import { useApp } from "./store/useApp";

beforeEach(() => {
  useApp.setState({
    xFmt: { mode: "auto", digits: 2 },
    yFmt: { mode: "auto", digits: 2 },
  });
});

function findCommand(id: string) {
  const action = buildAppActions(useApp.getState).find((a) => a.id === id);
  if (!action) throw new Error(`command "${id}" not registered`);
  return action;
}

describe("Cycle X/Y tick format commands (MAIN #20)", () => {
  it("yTickFormat cycles auto -> fixed -> sci -> eng -> auto, preserving digits", () => {
    useApp.setState({ yFmt: { mode: "auto", digits: 3 } });
    const cmd = findCommand("yTickFormat");
    expect(cmd.group).toBe("Plot");
    cmd.run();
    expect(useApp.getState().yFmt).toEqual({ mode: "fixed", digits: 3 });
    cmd.run();
    expect(useApp.getState().yFmt).toEqual({ mode: "sci", digits: 3 });
    cmd.run();
    expect(useApp.getState().yFmt).toEqual({ mode: "eng", digits: 3 });
    cmd.run();
    expect(useApp.getState().yFmt).toEqual({ mode: "auto", digits: 3 });
  });

  it("xTickFormat cycles independently of yFmt", () => {
    const cmd = findCommand("xTickFormat");
    cmd.run();
    expect(useApp.getState().xFmt.mode).toBe("fixed");
    expect(useApp.getState().yFmt.mode).toBe("auto"); // untouched
  });
});
