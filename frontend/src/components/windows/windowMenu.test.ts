// windowMenu — the GUI_INTERACTION #8 registry entries behind the window
// title-bar's right-click menu (WindowTitleButtons). Same store-seeded
// convention as useWindowCommands.test.ts's own `win()` helper.

import { beforeEach, describe, expect, it } from "vitest";

import { defaultPlotView, type PlotWindow } from "../../lib/plotview";
import { useApp } from "../../store/useApp";
import { windowActions, windowCloseAction, type WindowActionTarget } from "./windowMenu";

const win = (over: Partial<PlotWindow> = {}): PlotWindow => ({
  id: "w1",
  kind: "plot",
  title: "",
  datasetId: "d1",
  geometry: { x: 0, y: 0, w: 480, h: 360 },
  z: 0,
  winState: "normal",
  view: defaultPlotView(),
  bg: "theme",
  linkGroup: null,
  pinned: false,
  ...over,
});

function findAction(id: string) {
  const a = windowActions.find((x) => x.id === id);
  if (!a) throw new Error(`no action ${id}`);
  return a;
}

beforeEach(() => {
  useApp.setState({ plotWindows: [win({ id: "w1" })], focusedWindowId: "w1" });
});

describe("windowMenu — kind-gated visibility", () => {
  it("pin + link-cycle are hidden for a non-plot window, visible for a plot window", () => {
    const plotTarget: WindowActionTarget = { win: win({ kind: "plot" }) };
    const snapTarget: WindowActionTarget = { win: win({ kind: "snapshot" }) };
    const sheetTarget: WindowActionTarget = { win: win({ kind: "worksheet" }) };
    const pin = findAction("window.pin");
    const link = findAction("window.linkCycle");
    expect(pin.hidden?.(plotTarget)).toBe(false);
    expect(pin.hidden?.(snapTarget)).toBe(true);
    expect(pin.hidden?.(sheetTarget)).toBe(true);
    expect(link.hidden?.(plotTarget)).toBe(false);
    expect(link.hidden?.(snapTarget)).toBe(true);
    expect(link.hidden?.(sheetTarget)).toBe(true);
  });

  it("duplicate/close have no kind gate", () => {
    const snapTarget: WindowActionTarget = { win: win({ kind: "snapshot" }) };
    expect(findAction("window.duplicate").hidden?.(snapTarget)).toBeFalsy();
    expect(windowCloseAction.hidden?.(snapTarget)).toBeFalsy();
  });

  it("bgCycle mirrors the physical ◐ button's plot+snapshot gate", () => {
    const bg = findAction("window.bgCycle");
    expect(bg.hidden?.({ win: win({ kind: "plot" }) })).toBe(false);
    expect(bg.hidden?.({ win: win({ kind: "snapshot" }) })).toBe(false);
    expect(bg.hidden?.({ win: win({ kind: "worksheet" }) })).toBe(true);
    expect(bg.hidden?.({ win: win({ kind: "map" }) })).toBe(true);
    expect(bg.hidden?.({ win: win({ kind: "panel" }) })).toBe(true);
  });

  it("pin reflects the target window's own pinned flag, checked", () => {
    const pin = findAction("window.pin");
    expect(pin.checked?.({ win: win({ pinned: true }) })).toBe(true);
    expect(pin.checked?.({ win: win({ pinned: false }) })).toBe(false);
  });
});

// LABEL PARITY (see windowMenu.ts's module doc): these must match
// useWindowCommands.ts's palette Action labels verbatim — a drift guard so
// the title-bar menu and the ⌘K palette never silently diverge in wording,
// even though they target different windows (this window vs. the focused one).
describe("windowMenu — label parity with useWindowCommands.ts's palette actions", () => {
  it("matches the palette labels exactly", () => {
    const byId = Object.fromEntries(windowActions.map((a) => [a.id, a.label]));
    expect(byId["window.duplicate"]).toBe("Duplicate Window");
    expect(byId["window.pin"]).toBe("Pin Window (toggle)");
    expect(byId["window.linkCycle"]).toBe("Link Window Group (1 / 2 / 3 / Off)");
    expect(byId["window.bgCycle"]).toBe("Window Background (Theme / Light / Dark)");
    expect(byId["window.close"]).toBe("Close Window");
  });
});

describe("windowMenu — close action", () => {
  it("closes the TARGET window, not necessarily the focused one", () => {
    useApp.setState({ plotWindows: [win({ id: "w1" }), win({ id: "w2" })], focusedWindowId: "w1" });
    windowCloseAction.run({ win: win({ id: "w2" }) });
    expect(useApp.getState().plotWindows.map((w) => w.id)).toEqual(["w1"]);
  });
});

describe("windowMenu — duplicate action", () => {
  it("duplicates the target window and focuses the copy", () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "a", data: { time: [1], values: [[1]], labels: ["m"], units: [""], metadata: {} } }],
      plotWindows: [win({ id: "w1" })],
      focusedWindowId: "w1",
    });
    findAction("window.duplicate").run({ win: win({ id: "w1" }) });
    const s = useApp.getState();
    expect(s.plotWindows).toHaveLength(2);
    const dup = s.plotWindows.find((w) => w.id !== "w1")!;
    expect(s.focusedWindowId).toBe(dup.id);
  });
});

describe("windowMenu — pin/link/bg actions", () => {
  it("pin toggles the target window's pinned flag", () => {
    useApp.setState({ plotWindows: [win({ id: "w1", pinned: false })] });
    findAction("window.pin").run({ win: win({ id: "w1" }) });
    expect(useApp.getState().plotWindows[0].pinned).toBe(true);
  });

  it("linkCycle advances the target window's link group", () => {
    useApp.setState({ plotWindows: [win({ id: "w1", linkGroup: null })] });
    findAction("window.linkCycle").run({ win: win({ id: "w1" }) });
    expect(useApp.getState().plotWindows[0].linkGroup).toBe(1);
  });

  it("bgCycle advances the target window's background", () => {
    useApp.setState({ plotWindows: [win({ id: "w1", bg: "theme" })] });
    findAction("window.bgCycle").run({ win: win({ id: "w1" }) });
    expect(useApp.getState().plotWindows[0].bg).toBe("light");
  });
});
