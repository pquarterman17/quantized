// The default graph template (gap audit 5 #1): Origin's "set this template as
// the default for new graphs". Every NEW graph opens with the look of one
// saved graph template (`lib/figuredoc.ts`'s `qz.graphTemplates`), named by
// the `qz.defaultGraphTemplate` preference (store/prefs.ts).
//
// LAZY: store/windowDefaults.ts holds only a null-until-installed slot
// (`setNewGraphStyler`); this module fills it. The boot loads it only when a
// default is set (`warmDefaultGraphTemplate`), Preferences and the Plot menu's
// "Set as Default for New Graphs…" load it on use.
//
// What a new graph takes, split by what a rebind resets:
// - chrome (`CHROME_KEYS`): tick formats, grid, frame, legend, the plot
//   template (font and base line width) and axis-title fonts. Seeded once,
//   by `newGraphView`, on the app's own new-graph paths only.
// - per-position series styles: under every fresh binding
//   (`datasetViewDefaults`), BELOW the dataset's own (a parser's scatter hint,
//   technique memory), so the first import into an empty window keeps them.
// Never taken: axis scales and X reversal (the dataset's technique defaults
// own them), limits, titles, bindings, Y3+ axes, and anything on a recovered
// Origin graph, a saved figure, a recipe or a `.dwk` restore -- none of those
// read `newGraphView`.
//
// Fails closed: a default that names no saved template (deleted, renamed,
// storage refused) applies NOTHING, and the boot says so in the status bar.
// The template is re-read on every use, so re-saving it under the same name
// changes the default, as editing Origin's default template file does.

import { loadGraphTemplates } from "./figuredoc";
import { captureGraphFormat, graphFormatPatch, sanitizeGraphFormat, seriesStyleFromExport, type GraphFormat } from "./graphFormat";
import { effectiveChannels } from "./plotdata";
import { defaultPlotView, snapshotView, type PlotView, type PlotWindow } from "./plotview";
import type { SeriesStyle } from "./seriesStyleTypes";
import type { Dataset } from "./types";
import { DEFAULT_GRAPH_TEMPLATE_KEY } from "../store/prefs";
import { useApp, type AppState } from "../store/useApp";
import { setNewGraphStyler } from "../store/windowDefaults";
import { plotWindowDatasetId, plotWindowView, syncPlotWindow } from "../store/windowDocuments";
import { viewHasUserEdits } from "../store/windowUserEdits";

/** The slot type store/windowDefaults.ts holds (type-only there). */
export interface NewGraphStyler {
  /** The chrome a new graph opens with ({} = none). */
  chrome(): Partial<PlotView>;
  /** Per-channel styles for a fresh binding of `view` to `dataset`. */
  seriesStyles(dataset: Dataset, view: Partial<PlotView>): Record<number, SeriesStyle>;
}

/** The view fields a default template seeds on a new graph. */
export const CHROME_KEYS = [
  "xFmt", "yFmt", "y2Fmt", "showGrid", "showAxisBox", "showLegend", "legendPos", "legendStatic",
  "plotTemplate", "axisLabelStyles", "seriesRamp",
] as const satisfies readonly (keyof PlotView)[];

export function loadDefaultGraphTemplateName(): string | null {
  try {
    const raw = localStorage.getItem(DEFAULT_GRAPH_TEMPLATE_KEY);
    const name: unknown = raw === null ? null : JSON.parse(raw);
    return typeof name === "string" && name.trim() ? name : null;
  } catch {
    return null; // unreadable or damaged: no default (fail closed)
  }
}

function saveDefaultGraphTemplateName(name: string | null): void {
  try {
    if (name) localStorage.setItem(DEFAULT_GRAPH_TEMPLATE_KEY, JSON.stringify(name));
    else localStorage.removeItem(DEFAULT_GRAPH_TEMPLATE_KEY);
  } catch {
    /* storage unavailable (private mode): the default lasts this session */
  }
}

/** The default template's Stage format, or null (none set, or it names no
 *  saved template). A template without its own `format` (saved before it
 *  existed, or an Origin .otp) restyles from its publication series styles
 *  over the built-in chrome -- as "Apply Graph Template…" does. */
export function defaultGraphFormat(): GraphFormat | null {
  const name = loadDefaultGraphTemplateName();
  const template = name === null ? undefined : loadGraphTemplates().find((t) => t.name === name);
  if (!template) return null;
  return sanitizeGraphFormat(template.format) ?? {
    ...captureGraphFormat(defaultPlotView(), []),
    series: (template.seriesStyles ?? []).map(seriesStyleFromExport),
  };
}

/** The plotted channels of `view` on `dataset` in display order, Y2 last --
 *  the positions a format's series styles land on (shared with the Plot
 *  menu's Apply Graph Template / Paste Format). */
export function plottedChannels(
  dataset: Dataset,
  view: Partial<Pick<PlotView, "yKeys" | "xKey" | "seriesOrder" | "y2Keys">>,
): number[] {
  const y2 = view.y2Keys ?? [];
  return effectiveChannels(dataset.data, view.yKeys ?? null, view.xKey ?? null, dataset.channelRoles, view.seriesOrder ?? null)
    .filter((ch) => !y2.includes(ch))
    .concat(y2);
}

/** The chrome fields `view` sets (a format saved before gradients existed
 *  carries no `seriesRamp`: the built-in value stands). */
function pick(view: Partial<PlotView>): Partial<PlotView> {
  return Object.fromEntries(CHROME_KEYS.filter((k) => view[k] !== undefined).map((k) => [k, view[k]])) as Partial<PlotView>;
}

const STYLER: NewGraphStyler = {
  chrome: () => {
    const format = defaultGraphFormat();
    return format ? pick(graphFormatPatch(format, [], {})) : {};
  },
  seriesStyles: (dataset, view) => {
    const format = defaultGraphFormat();
    return format ? (graphFormatPatch(format, plottedChannels(dataset, view), {}).seriesStyles ?? {}) : {};
  },
};

/** What `win` shows now: the live singletons for the focused window. */
function viewOf(s: AppState, win: PlotWindow): PlotView {
  return win.id === s.focusedWindowId ? snapshotView(s) : plotWindowView(win);
}

/** Run `change` (which swaps the default), then give every EMPTY graph -- a
 *  plot window with no data that was never styled, judged under the OLD
 *  default, like the window the app starts with -- the new default's chrome.
 *  Anything with data or an edit is an existing graph and is left alone. */
function restyleEmptyGraphs(change: () => void): void {
  const before = useApp.getState();
  const empty = new Set(
    before.plotWindows
      .filter((w) => w.kind === "plot" && plotWindowDatasetId(w) === null && !viewHasUserEdits(viewOf(before, w), undefined))
      .map((w) => w.id),
  );
  change();
  if (empty.size === 0) return;
  const s = useApp.getState();
  const chrome = defaultGraphFormat() ? STYLER.chrome() : { ...pick(defaultPlotView()), showGrid: s.defaultGrid };
  useApp.setState({
    ...(s.focusedWindowId !== null && empty.has(s.focusedWindowId) ? chrome : {}),
    plotWindows: s.plotWindows.map((w) => (empty.has(w.id) ? syncPlotWindow(w, { ...viewOf(s, w), ...chrome }) : w)),
  });
}

/** Boot (store/prefs.ts `warmDefaultGraphTemplate`): fill the slot. */
export function installDefaultGraphTemplate(): void {
  restyleEmptyGraphs(() => setNewGraphStyler(STYLER));
  const name = loadDefaultGraphTemplateName();
  if (name && !defaultGraphFormat()) {
    useApp.getState().setStatus(`Default graph template "${name}" not found — new graphs open with the built-in look`);
  }
}

/** Make the saved template `name` (null = none) the default for new graphs. */
export function setDefaultGraphTemplate(name: string | null): void {
  restyleEmptyGraphs(() => {
    saveDefaultGraphTemplateName(name);
    setNewGraphStyler(STYLER);
  });
}
