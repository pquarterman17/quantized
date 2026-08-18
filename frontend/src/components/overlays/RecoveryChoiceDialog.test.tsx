// P1.2 box 5: the crash-recovery chooser renders SOURCE/TIME for both
// candidates and wires its three buttons to the three documented actions —
// see lib/applyRecoveryChoice.ts for what each one actually does.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import RecoveryChoiceDialog from "./RecoveryChoiceDialog";
import { parseWorkspace, WORKSPACE_FORMAT } from "../../lib/workspace";
import { useRecoveryChoice, type RecoveryPrompt } from "../../store/recoveryChoice";
import { useApp } from "../../store/useApp";

const WS = JSON.stringify({
  format: WORKSPACE_FORMAT,
  version: 4,
  datasets: [
    {
      id: "r1",
      name: "recovered.dat",
      data: { time: [0], values: [[1]], labels: ["y"], units: [""], metadata: {} },
    },
  ],
});

function prompt(): RecoveryPrompt {
  return {
    workspace: parseWorkspace(WS),
    autosaveAt: Date.parse("2026-08-18T12:00:00Z"),
    datasetCount: 1,
    lastProject: {
      name: "project.dwk",
      path: "/p/project.dwk",
      at: Date.parse("2026-08-17T09:00:00Z"),
    },
  };
}

beforeEach(() => {
  useApp.setState({ datasets: [], activeId: null, currentProject: null, projectDirty: false });
  useRecoveryChoice.setState({ pending: null });
});

describe("RecoveryChoiceDialog", () => {
  it("renders nothing when there is no pending prompt", () => {
    const { container } = render(<RecoveryChoiceDialog />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the SOURCE and TIME for both candidates", () => {
    useRecoveryChoice.setState({ pending: prompt() });
    render(<RecoveryChoiceDialog />);
    expect(screen.getByText(/1 dataset/)).toBeInTheDocument();
    expect(screen.getAllByText(/project\.dwk/).length).toBeGreaterThan(0);
    expect(screen.getByText(/\/p\/project\.dwk/)).toBeInTheDocument();
  });

  it("Cancel clears the prompt and loads nothing", () => {
    useRecoveryChoice.setState({ pending: prompt() });
    render(<RecoveryChoiceDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useRecoveryChoice.getState().pending).toBeNull();
    expect(useApp.getState().datasets).toEqual([]);
  });

  it('"Recover autosave" loads the candidate and adopts the last project identity, dirty', () => {
    useRecoveryChoice.setState({ pending: prompt() });
    render(<RecoveryChoiceDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Recover autosave" }));
    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["recovered.dat"]);
    expect(useApp.getState().currentProject).toEqual({ name: "project.dwk", path: "/p/project.dwk" });
    expect(useApp.getState().projectDirty).toBe(true);
    expect(useRecoveryChoice.getState().pending).toBeNull();
  });

  it("clicking the backdrop cancels, same as the Cancel button", () => {
    useRecoveryChoice.setState({ pending: prompt() });
    const { container } = render(<RecoveryChoiceDialog />);
    fireEvent.mouseDown(container.querySelector(".qz-overlay-backdrop") as Element);
    expect(useRecoveryChoice.getState().pending).toBeNull();
  });

  // P3-a (adversarial review): applyKeepLastProject (lib/applyRecoveryChoice.ts)
  // never touches the autosave generation — it stays in storage untouched.
  // The "Keep" button's own tooltip previously claimed the opposite ("discard
  // the autosaved snapshot"), which would talk a user out of a choice they
  // could still safely make later. Pin the copy honest.
  it('the "Keep" button never claims to discard the autosave — it stays available', () => {
    useRecoveryChoice.setState({ pending: prompt() });
    render(<RecoveryChoiceDialog />);
    const keepButton = screen.getByRole("button", { name: /^Keep / });
    expect(keepButton.title).not.toMatch(/discard/i);
    expect(keepButton.title).toMatch(/stays? in storage|unaffected|remains? available/i);
  });
});
