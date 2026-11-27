// UX menus audit, lane A: the menu bar model, commands and palette, asserted
// over the REAL registry (M1 aux-figure availability, M2 / M3 menu homes, M9,
// N2 wording, N3 state, N4 grouping, N5 / N6 labels, N7 Data menu, N15, N17).

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildAppActions } from "../../appCommands";
import { MENU_STATE_IDS } from "../../commands/menuState";
import { AUX_VIEW_HAS_OWN_EXPORT, AUX_VIEW_IS_NOT_XY } from "../../lib/auxFigureView";
import { runExportFigureCommand } from "../../lib/exportFigureCommand";
import { buildStageFigureSpec, POLAR_MAP_EXPORT_REFUSAL } from "../../lib/figureSpecStage";
import { rankActions } from "../../lib/paletteRank";
import { setPlots2Mode } from "../../lib/plots2Mode";
import { setPolarMapMode } from "../../lib/polarMapMode";
import type { Dataset } from "../../lib/types";
import { mergeSearchable } from "../../commands/hookCommandDocs";
import { useStatsTestsStore } from "../../store/statsTests";
import { useApp } from "../../store/useApp";
import type { ContextMenuItem } from "../overlays/ContextMenu";
import { buildAppMenuItems } from "./appMenuModel";

type Row = { label: string; shortcutLabel?: string; disabled?: boolean; title?: string; checked?: boolean; submenu?: ContextMenuItem[] };
const rows = (items: ContextMenuItem[]): Row[] => items.filter((i): i is ContextMenuItem & Row => "label" in i);
const walk = (items: ContextMenuItem[], out: Row[] = []): Row[] => {
  for (const r of rows(items)) {
    out.push(r);
    if (r.submenu) walk(r.submenu, out);
  }
  return out;
};
const fmt = (s: string) => s;
const state = () => useApp.getState();
const all = () => buildAppActions(state);
// The palette list: the registry with the legacy-label synonyms merged in, as the app builds it.
const palette = () => mergeSearchable(all(), []);
const menu = (group: string) => buildAppMenuItems(group, all(), fmt);
const find = (group: string, label: string): Row | undefined => walk(menu(group)).find((r) => r.label === label);
const flyout = (group: string, name: string): string[] =>
  rows((menu(group).find((i) => "label" in i && i.label === name) as { submenu: ContextMenuItem[] } | undefined)?.submenu ?? []).map((r) => r.label);

const ds = {
  id: "d1",
  name: "six.csv",
  data: { time: [0, 1, 2], values: [[1, 4, 7], [2, 5, 8], [3, 6, 9]], labels: ["A", "B", "C"], units: ["", "", ""], metadata: {} },
} as unknown as Dataset;

beforeEach(() => useApp.setState({ datasets: [ds], activeId: "d1", polarMode: false }));
afterEach(() => {
  setPlots2Mode(null);
  setPolarMapMode(false);
  useApp.setState({ polarMode: false });
});

const XY_ONLY = ["Toggle legend", "Toggle grid lines", "Log Y scale", "X axis settings…", "Autoscale / reset view"];
const EXPORTS = ["Export PDF…", "Export SVG…", "Export PNG…", "Export figure…", "Export figure (quick dialog)…"];

describe("M1: aux-figure views disable the XY-only commands", () => {
  it("is all enabled on the XY plot", () => {
    for (const l of [...XY_ONLY, ...EXPORTS, "Arrow"]) {
      const g = l === "Arrow" ? "Insert" : l.startsWith("Export") ? "File" : "Plot";
      expect(find(g, l)?.disabled, l).toBe(false);
    }
  });

  it.each([
    ["a Plots2 view", () => setPlots2Mode("pareto")],
    ["the polar map", () => { useApp.setState({ polarMode: true }); setPolarMapMode(true); }],
  ])("%s: exports point at the view's own Export; axes, legend and Insert say to go back", (_n, enter) => {
    enter();
    for (const l of EXPORTS) {
      const r = find("File", l);
      expect(r?.disabled, l).toBe(true);
      expect(r?.title, l).toBe(AUX_VIEW_HAS_OWN_EXPORT);
    }
    for (const l of XY_ONLY) expect(find("Plot", l), l).toMatchObject({ disabled: true, title: AUX_VIEW_IS_NOT_XY });
    expect(find("Insert", "Arrow")).toMatchObject({ disabled: true, title: AUX_VIEW_IS_NOT_XY });
    expect(find("Edit", "Copy figure")).toMatchObject({ disabled: true });
    // The way back stays open.
    expect(find("Plot", "Plot type…")?.disabled).toBe(false);
    expect(find("Plot", "Polar map / pole figure…")?.disabled).toBe(false);
  });

  it("a polar LINES plot (not the map) keeps the XY menu", () => {
    useApp.setState({ polarMode: true });
    expect(find("Plot", "Toggle legend")?.disabled).toBe(false);
  });

  it("a stale view flag with no active dataset disables nothing (the stage is not mounted)", () => {
    setPlots2Mode("hexbin");
    useApp.setState({ activeId: null });
    expect(find("Plot", "Plot type…")?.disabled).toBe(true); // nothing to act on: the ordinary reason
    expect(find("Plot", "Toggle legend")?.title).toBe("Import or select a dataset first");
  });

  it("the palette's Export PDF refuses before any dialog (no format question, no XY export)", async () => {
    setPlots2Mode("kde2d");
    await runExportFigureCommand(state, undefined, "pdf"); // would await a dialog forever if it asked
    expect(state().status).toContain("has its own Export");
  });

  it("Copy figure / spec building refuses the polar map like a Plots2 view", () => {
    useApp.setState({ polarMode: true });
    setPolarMapMode(true);
    expect(() => buildStageFigureSpec(state, ds, "d", {} as never)).toThrow(POLAR_MAP_EXPORT_REFUSAL);
  });
});

describe("M2: the polar map / pole figure has a menu and palette home", () => {
  it("is listed under Plot > Create (Charts merged into it) and Analyze > Maps; Build & export is gone, exports moved to File", () => {
    expect(menu("Plot").some((i) => "label" in i && i.label === "Charts")).toBe(false);
    expect(flyout("Plot", "Create")).toEqual(expect.arrayContaining(["Function plot (y = f(x))…", "Graph builder…", "Parallel coordinates…", "Pareto chart…", "Polar map / pole figure…"]));
    expect(flyout("Analyze", "Maps")).toEqual(expect.arrayContaining(["Map operations…", "Polar map / pole figure…"]));
    expect(menu("Plot").some((i) => "label" in i && i.label === "Build & export")).toBe(false);
    expect(flyout("File", "Export")).toEqual(expect.arrayContaining(["Multi-panel export…", "Send figure to report…"]));
  });

  it.each(["pole figure", "stereographic", "pole", "texture", "schmidt"])("palette query %s finds it first", (q) => {
    expect(rankActions(palette(), q, {})[0]?.a.id, q).toBe("plot-polar-map");
  });

  it("is disabled with the plot-type reason when the sheet has too few columns, and runs the plot-type switch otherwise", () => {
    useApp.setState({ datasets: [{ ...ds, data: { ...ds.data, labels: ["A"], values: [[1], [2], [3]], units: [""] } } as Dataset] });
    expect(find("Plot", "Polar map / pole figure…")).toMatchObject({ disabled: true, title: "Needs tilt, azimuth and intensity columns." });
  });

  it("old names still find moved items: Levelling, the long Statistical tests title", () => {
    expect(rankActions(palette(), "levelling", {})[0]?.a.id).toBe("map-ops");
    expect(rankActions(palette(), "weibull", {}).some((r) => r.a.id === "quality-life-distribution")).toBe(true);
    expect(rankActions(palette(), "dunnett", {})[0]?.a.id).toBe("stats-tests");
  });
});

describe("M3: SPC and life tests have direct commands and an Analyze flyout", () => {
  it("lists them under Analyze > Quality & reliability and opens Statistical tests on that test", () => {
    expect(flyout("Analyze", "Quality & reliability")).toEqual(["Control chart…", "Process capability…", "Life distribution…"]);
    for (const [id, test] of [["quality-control-chart", "control-chart"], ["quality-capability", "capability"], ["quality-life-distribution", "life-distribution"]] as const) {
      all().find((a) => a.id === id)!.run();
      expect(useStatsTestsStore.getState().request?.testId).toBe(test);
      expect(useStatsTestsStore.getState().open).toBe(true);
      useStatsTestsStore.setState({ open: false, request: null });
    }
  });

  it("palette: control chart, capability and kaplan find the direct entries", () => {
    expect(rankActions(palette(), "control chart", {})[0]?.a.id).toBe("quality-control-chart");
    expect(rankActions(palette(), "capability", {})[0]?.a.id).toBe("quality-capability");
  });
});

describe("M9: Ctrl+N cannot reach a browser tab", () => {
  it("New workbook carries the desktop-app note like the window chords", () => {
    expect(find("File", "New workbook")?.shortcutLabel).toContain("(desktop app)");
  });
});

describe("N2: one phrase for 'no dataset'", () => {
  it("every disabled-without-data item reads the same", () => {
    useApp.setState({ datasets: [], activeId: null });
    const reasons = new Set<string>();
    for (const g of ["File", "Data", "Plot", "Analyze", "Insert"]) {
      for (const r of walk(menu(g))) if (r.disabled && /dataset|worksheet|import/i.test(r.title ?? "")) reasons.add(r.title!);
    }
    expect([...reasons].filter((t) => /Needs an active worksheet|No datasets yet/.test(t))).toEqual([]);
  });
});

describe("N3: toggles and cycles show their state", () => {
  it("checks grid / legend / statistics view and names the current cycle value", () => {
    useApp.setState({ showGrid: true, showLegend: false, yScale: "log" });
    expect(find("Plot", "Toggle grid lines")?.checked).toBe(true);
    expect(find("Plot", "Toggle legend")?.checked).toBe(false);
    expect(find("Plot", "Cycle Y axis scale (now log)")).toBeDefined();
    expect(find("Plot", "Cycle X axis scale (now linear)")).toBeDefined();
    // The palette keeps the stable name.
    expect(all().find((a) => a.id === "yLog")?.label).toBe("Cycle Y axis scale");
  });

  it("every state-table id is a real command", () => {
    const ids = new Set(all().map((a) => a.id));
    expect(MENU_STATE_IDS.filter((id) => !ids.has(id))).toEqual([]);
  });
});

describe("N4: Plot > Axes and Display grouping", () => {
  it("Axes lists X, then Y, then both, with separators; view history is at the Plot root", () => {
    const axes = (menu("Plot").find((i) => "label" in i && i.label === "Axes") as { submenu: ContextMenuItem[] }).submenu;
    const groups: string[][] = [[]];
    for (const i of axes) {
      if ("separator" in i) groups.push([]);
      else if ("label" in i) groups[groups.length - 1]!.push(i.label);
    }
    expect(groups.map((g) => g.length)).toEqual([4, 4, 1, 4]);
    expect(groups[0]!.every((l) => /X /.test(l))).toBe(true);
    expect(groups[1]!.every((l) => /Y /.test(l))).toBe(true);
    const root = rows(menu("Plot")).map((r) => r.label);
    expect(root).toEqual(expect.arrayContaining(["Back to previous view", "Forward to next view"]));
    expect(flyout("Plot", "Axes")).not.toContain("Back to previous view");
  });

  it("templates and the format painter have their own flyout; the view toggles joined Curves & legend", () => {
    expect(flyout("Plot", "Templates & format")).toEqual(expect.arrayContaining(["Save graph template…", "Copy format", "Paste format"]));
    expect(menu("Plot").some((i) => "label" in i && i.label === "Display")).toBe(false); // a 3-item flyout cost a root row
    expect(flyout("Plot", "Curves & legend")).toEqual(expect.arrayContaining(["Toggle statistics view", "Magnifier inset", "Plot type…", "Legend…"]));
  });
});

describe("N5 / N6: label hygiene", () => {
  it("every menu label fits a flyout (40 characters) and has no parenthesis after an ellipsis", () => {
    const long: string[] = [];
    const tail: string[] = [];
    for (const g of ["File", "Edit", "Data", "Plot", "Insert", "Analyze", "Tools", "View"]) {
      for (const r of walk(menu(g))) {
        if (r.label.length > 40 && !r.title?.includes("Recent")) long.push(`${g}: ${r.label}`);
        if (/…\s*\(/.test(r.label)) tail.push(r.label);
      }
    }
    expect(long).toEqual([]);
    expect(tail).toEqual([]);
  });

  it("each shortened label stays searchable by its old text", () => {
    expect(rankActions(palette(), "hexagon", {}).length).toBeGreaterThan(0);
    expect(rankActions(palette(), "Graph Builder drag columns wells", {})[0]?.a.id).toBe("graph-builder");
    expect(rankActions(palette(), "frequency count bin a column", {})[0]?.a.id).toBe("frequency-count");
  });

  it("Analyze keeps instrument items with their domain", () => {
    expect(flyout("Analyze", "XRD & reflectivity")).toEqual(expect.arrayContaining(["Film thickness (FFT)…", "Reflectivity FFT…"]));
    expect(flyout("Analyze", "Transform & signal")).not.toContain("SIMS depth profile…");
    expect(flyout("Analyze", "Spectroscopy & magnetometry")).toEqual(
      expect.arrayContaining(["Optical gap (Tauc plot)…", "SIMS depth profile…", "Hysteresis analysis…", "Magnetometry tools…"]),
    );
    expect(menu("Analyze").some((i) => "label" in i && i.label === "Magnetometry")).toBe(false); // folded in: a root row
  });
});

describe("N7: the Data menu", () => {
  it("lists Sort worksheet and Add column, and Transpose sits with the column reshapes", () => {
    expect(flyout("Data", "Rows & summary")).toContain("Sort worksheet…");
    expect(flyout("Data", "Columns")).toEqual(expect.arrayContaining(["Add column", "Transpose worksheet…"]));
    expect(flyout("Data", "Combine & split")).not.toContain("Transpose worksheet…");
    expect(rankActions(palette(), "sort worksheet", {})[0]?.a.id).toBe("sort-worksheet");
  });
});

describe("N15 / N17 / N18", () => {
  it("one name for the calculators, DiraCulator still finds it", () => {
    expect(find("Tools", "Calculators…")).toBeDefined();
    expect(rankActions(palette(), "diraculator", {})[0]?.a.id).toBe("calculators");
  });

  it("a bare-letter shortcut says it is ignored in text fields (when the item is enabled)", () => {
    const fit = find("Analyze", "Curve fit…");
    expect(fit?.title).toContain("when no text field has focus");
  });
});
