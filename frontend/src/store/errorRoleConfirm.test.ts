// A user's explicit confirmation of an adjacency-only (`low`) error pairing is
// DURABLE (lib/errorRoleConfirm.ts): recorded in the dataset's
// `metadata.error_roles` (the P1.6 contract), so the next Quick Plot -- also
// after a `.dwk` save/reopen -- applies it without asking. Declining records
// nothing, so the question comes back.
import { beforeEach, describe, expect, it } from "vitest";
import { waitFor } from "@testing-library/react";

import { reviewSeedErrorBindings } from "../lib/errorBindingConfidence";
import { confirmAppliedPairings, confirmErrorBindings, withdrawErrorBindingConfirmation } from "../lib/errorRoleConfirm";
import { initialQuickFigureMapping } from "../lib/quickFigureMappingActions";
import type { Dataset, ErrorBinding } from "../lib/types";
import { parseWorkspace, serializeWorkspace } from "../lib/workspace";
import { useParamDialog } from "./paramDialog";
import { runQuickPlot } from "./quickPlotRun";
import { useApp } from "./useApp";

const LOW: ErrorBinding = { channel: 1, target: 0, axis: "y", side: "both" };

function sheet(): Dataset {
  return {
    id: "low",
    name: "low.dat",
    data: {
      time: [0, 1, 2],
      values: [[1, 0.1], [2, 0.2], [3, 0.3]],
      labels: ["M", "err"],
      units: ["", ""],
      metadata: { technique: "magnetometry.mvsh" },
    },
    errorRoles: [LOW],
  };
}

beforeEach(() => {
  useParamDialog.getState().close();
  useApp.setState({
    datasets: [sheet()],
    activeId: null,
    selectedIds: [],
    plotWindows: [],
    focusedWindowId: null,
    editableFigures: [],
    techniqueViewMemory: {},
    history: [],
    future: [],
    status: "",
  });
});

const ds = () => useApp.getState().datasets[0];
const figures = () => useApp.getState().editableFigures;

/** Run the menu-path Quick Plot and answer its question with `tick`. */
async function quickPlotAnswering(tick: boolean | null): Promise<void> {
  const before = figures().length;
  runQuickPlot("low");
  await waitFor(() => expect(useParamDialog.getState().title).not.toBeNull());
  const field = useParamDialog.getState().fields[0];
  useParamDialog.getState().resolve?.(tick === null ? null : { [field.key]: tick });
  if (tick === null) await waitFor(() => expect(useApp.getState().status).toMatch(/cancelled/));
  else await waitFor(() => expect(figures()).toHaveLength(before + 1));
  useParamDialog.getState().close();
}

describe("confirming a low pairing in Quick Plot is durable", () => {
  it("a ticked box is recorded, and the next Quick Plot applies it without asking", async () => {
    await quickPlotAnswering(true);
    expect(ds().data.metadata.error_roles).toEqual([LOW]);
    runQuickPlot("low"); // synchronous now: nothing left to ask
    expect(figures()).toHaveLength(2);
    expect(useParamDialog.getState().title).toBeNull();
    expect(figures()[1].bindings.errors).toEqual([LOW]);
  });

  it("the confirmation survives a .dwk save and reopen", async () => {
    await quickPlotAnswering(true);
    const loaded = parseWorkspace(serializeWorkspace(useApp.getState()));
    useApp.setState({ datasets: loaded.datasets, editableFigures: [], plotWindows: [] });
    expect(reviewSeedErrorBindings(ds()).confirm).toEqual([]);
    runQuickPlot("low");
    expect(figures()).toHaveLength(1);
    expect(useParamDialog.getState().title).toBeNull();
    expect(figures()[0].bindings.errors).toEqual([LOW]);
  });

  it("an unticked box records nothing, so the next Quick Plot asks again", async () => {
    await quickPlotAnswering(false);
    expect(ds().data.metadata.error_roles).toBeUndefined();
    await quickPlotAnswering(false); // it asked
    expect(figures()).toHaveLength(2);
  });

  it("Cancel records nothing either", async () => {
    await quickPlotAnswering(null);
    expect(ds().data.metadata.error_roles).toBeUndefined();
    expect(reviewSeedErrorBindings(ds()).confirm).toHaveLength(1);
  });

  it("one Undo removes the figure and the confirmation together", async () => {
    await quickPlotAnswering(true);
    useApp.getState().undo();
    expect(figures()).toHaveLength(0);
    expect(ds().data.metadata.error_roles).toBeUndefined();
  });
});

describe("the other confirmation surfaces write the same record", () => {
  it("the Quick Figure Builder confirms a low pairing the created mapping carries, and only that", () => {
    const withheld = initialQuickFigureMapping(ds());
    confirmAppliedPairings(ds(), withheld.errorBindings); // user left it withheld
    expect(ds().data.metadata.error_roles).toBeUndefined();
    confirmAppliedPairings(ds(), [LOW]); // user applied it
    expect(ds().data.metadata.error_roles).toEqual([LOW]);
    expect(initialQuickFigureMapping(ds()).errorBindings).toEqual([LOW]);
  });

  it("a parser's declared roles are kept, and a withdrawal removes only that column", () => {
    const parser: ErrorBinding = { channel: 0, target: 1, axis: "y", side: "both" };
    useApp.setState({ datasets: [{ ...ds(), data: { ...ds().data, metadata: { ...ds().data.metadata, error_roles: [parser] } } }] });
    confirmErrorBindings("low", [LOW]);
    expect(ds().data.metadata.error_roles).toEqual([parser, LOW]);
    withdrawErrorBindingConfirmation("low", 1);
    expect(ds().data.metadata.error_roles).toEqual([parser]);
  });
});
