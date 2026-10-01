// Accessible-name ratchet, render-level half (PRIMARY_SOFTWARE_AUDIT_PLAN —
// "Accessible names/state for icons…", U6). The static half
// (`accessibleNames.test.ts`) reads JSX; this one renders the shell chrome and
// the glyph-heavy panels and asks dom-accessibility-api — the same name
// computation Testing Library's `getByRole(…, { name })` uses — what each
// control is actually called. That catches what source text can't show: a
// control named through a prop (`<Switch>` inside a row that is not a
// <label>), or a name assembled from several children.
//
// Every control on these surfaces must have a name that reads as words.
// components/Library is out of scope here (owned by a separate pass, pinned
// in the static half).

import { fireEvent, isInaccessible, render, screen } from "@testing-library/react";
import { computeAccessibleName } from "dom-accessibility-api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AppearanceMenu from "./components/Shell/AppearanceMenu";
import CalcTitleBar from "./components/Shell/CalcTitleBar";
import MenuBar from "./components/Shell/MenuBar";
import StatusBar from "./components/Shell/StatusBar";
import TitleBar from "./components/Shell/TitleBar";
import PreferencesDialog from "./components/overlays/PreferencesDialog";
import MapToolbar, { type MapToolbarProps } from "./components/Stage/MapToolbar";
import PlotLegend from "./components/Stage/PlotLegend";
import PlotToolbar from "./components/Stage/PlotToolbar";
import Stage from "./components/Stage/Stage";
import DigitizerView from "./components/workshops/digitizer/DigitizerView";
import { useConnection } from "./lib/lifecycle";
import type { Action } from "./store/commands";
import { useApp } from "./store/useApp";
import { isWordLikeName } from "./test/accessibleNameScan";

// The Stage's views are heavy canvases; only its tab strip is under test here.
vi.mock("./components/windows/WindowCanvas", () => ({ default: () => <div>plot-canvas</div> }));
vi.mock("./components/windows/useWindowCommands", () => ({ useWindowCommands: () => {} }));
vi.mock("./components/history/useHistoryCommands", () => ({ useHistoryCommands: () => {} }));

const CONTROLS = [
  "button",
  "a[href]",
  "input:not([type=hidden])",
  "select",
  "textarea",
  ...["button", "switch", "tab", "checkbox", "radio", "menuitem", "menuitemcheckbox", "menuitemradio"].map(
    (r) => `[role=${r}]`,
  ),
].join(", ");

/** Every accessible control under `root` whose computed name is a glyph or empty. */
function unnamedControls(root: HTMLElement): string[] {
  const out: string[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(CONTROLS)) {
    if (isInaccessible(el)) continue;
    const name = computeAccessibleName(el);
    if (!isWordLikeName(name)) {
      const what = el.getAttribute("title") ?? el.textContent?.trim() ?? "";
      out.push(`<${el.tagName.toLowerCase()} role=${el.getAttribute("role") ?? "-"}> named "${name}" (${what})`);
    }
  }
  return out;
}

const FIX = "give the control a short aria-label (one or two words, matching its tooltip)";

beforeEach(() => {
  useConnection.setState({ connected: true });
  useApp.setState({ currentProject: null, projectDirty: false, datasets: [], activeId: null });
});

afterEach(() => {
  useApp.getState().setPrefsOpen(false);
  window.history.pushState({}, "", "/");
});

describe("rendered controls are named in words (U6)", () => {
  it("the app title bar and the calculators title bar", () => {
    const { container } = render(<TitleBar />);
    expect(unnamedControls(container), FIX).toEqual([]);
    const calc = render(<CalcTitleBar />);
    expect(unnamedControls(calc.container), FIX).toEqual([]);
  });

  it("the menu bar with a menu open, and the status bar", () => {
    const actions: Action[] = [
      { id: "imp", group: "File", label: "Import data…", run: vi.fn() },
      { id: "thm", group: "View", label: "Toggle theme", run: vi.fn() },
    ];
    const menus = render(<MenuBar actions={actions} onOpenPalette={vi.fn()} />);
    fireEvent.click(screen.getByText("File"));
    expect(unnamedControls(menus.container), FIX).toEqual([]);
    // (Its per-op Cancel names are pinned in StatusBar.test.tsx, under fake timers.)
    const status = render(<StatusBar />);
    expect(unnamedControls(status.container), FIX).toEqual([]);
  });

  it("the appearance menu, opened", () => {
    const { container } = render(<AppearanceMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    expect(unnamedControls(container), FIX).toEqual([]);
  });

  it("every Preferences tab", () => {
    useApp.getState().setPrefsOpen(true);
    const { baseElement } = render(<PreferencesDialog />);
    for (const tab of ["Appearance", "Plot", "Interaction", "Numbers", "Keyboard"]) {
      fireEvent.click(screen.getByText(tab, { selector: ".qzk-prefs-tab" }));
      expect(unnamedControls(baseElement), `${tab} tab: ${FIX}`).toEqual([]);
    }
  });

  it("the 2-D map toolbar", () => {
    const props = {
      datasetId: "ds-a", painted: null,
      qAvailable: true, isAngular: true, isQ: false, onAngular: vi.fn(), onQ: vi.fn(),
      labels: ["2Theta", "Omega", "Intensity", "Qx", "Qz"], keys: [0, 1, 2], onKeyChange: vi.fn(),
      cmap: "viridis", cmapOptions: ["viridis"], onCmapChange: vi.fn(),
      logZ: false, onToggleLogZ: vi.fn(), contourOn: false, onToggleContour: vi.fn(),
      cutSpace: "q", gridable: true, cutMode: "off", onSetCutMode: vi.fn(),
      cutWidth: 0, onSetCutWidth: vi.fn(), cutWidthTooltip: "", onProjection: vi.fn(),
      roiMode: "off", onToggleRoi: vi.fn(),
      rulerMode: "off", onToggleRuler: vi.fn(),
      wedgeMode: "off", onToggleWedge: vi.fn(),
      onExport: vi.fn(),
    } as MapToolbarProps;
    const { container } = render(<MapToolbar {...props} />);
    expect(unnamedControls(container), FIX).toEqual([]);
  });

  it("the graph digitizer, whose image loader is a focusable, named button", () => {
    const { container } = render(<DigitizerView />);
    expect(unnamedControls(container), FIX).toEqual([]);
    const input = container.querySelector<HTMLInputElement>("input[type=file]")!;
    const pick = vi.spyOn(input, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Load image" }));
    expect(pick).toHaveBeenCalledTimes(1);
  });

  it("the plot toolbar, with its drawing-tool flyout open", () => {
    const noop = vi.fn();
    const { baseElement } = render(
      <PlotToolbar
        onReset={noop} onSmartScale={noop} onSavePng={noop}
        onCopyData={noop} onCopyFigure={noop} onSnapshotWindow={noop}
      />,
    );
    expect(unnamedControls(baseElement), FIX).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Choose drawing tool" }));
    expect(unnamedControls(baseElement), `drawing flyout: ${FIX}`).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Toolbar Options" }));
    expect(screen.getByRole("menuitemcheckbox", { name: "Group labels" })).toBeInTheDocument();
    expect(unnamedControls(baseElement), `options menu: ${FIX}`).toEqual([]);
  });

  it("the plot legend, whose show/hide entries are named, checkable controls", () => {
    useApp.setState({ hiddenChannels: [1], legendPos: "ne", plotTool: "pointer" });
    const { container } = render(
      <PlotLegend series={[{ label: "Moment", unit: "" }, { label: "Field", unit: "" }]} plotted={[0, 1]} hidden={[false, true]} />,
    );
    expect(unnamedControls(container), FIX).toEqual([]);
    // A mouse-only click target is invisible to the name scan above, so ask
    // for the entries by role: each one is a focusable checkbox named by its series.
    const entries = screen.getAllByRole("checkbox");
    expect(entries.map((e) => [computeAccessibleName(e), e.getAttribute("aria-checked"), e.tabIndex])).toEqual([
      ["Moment", "true", 0],
      ["Field", "false", 0],
    ]);
  });

  it("the Stage tab strip", () => {
    const data = { time: [0, 1], values: [[1], [2]], labels: ["c"], units: [""], metadata: {} };
    useApp.setState({ datasets: [{ id: "d1", name: "d.dat", data }], activeId: "d1", stageTab: "plot" });
    const { container } = render(<Stage />);
    const strip = screen.getByRole("tablist", { name: "Stage view" });
    expect(screen.getAllByRole("tab").map((t) => computeAccessibleName(t))).toEqual(["Plot", "Worksheet"]);
    expect(strip).toContainElement(screen.getByRole("tab", { name: "Plot" }));
    expect(unnamedControls(container), FIX).toEqual([]);
  });
});
