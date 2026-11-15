// The default graph template (gap audit 5 #1): Origin's "set this template as
// the default for new graphs". Every NEW graph opens with the look of one
// saved graph template (`lib/figuredoc.ts`'s `qz.graphTemplates`), named by
// the `qz.defaultGraphTemplate` preference (`DEFAULT_GRAPH_TEMPLATE_KEY`).
//
// LAZY: store/windowDefaults.ts holds only a null-until-installed slot
// (`setNewGraphStyler`) and the per-window `templateSeeds` marker; this module
// fills the slot, and every seed carries its own `apply` / `seriesFor`. The boot loads it only when a default is set
// (commands/plotCommands.ts `warmDefaultGraphTemplate`); Preferences and the
// Plot menu's "Set as Default for New Graphs…" load it on use.
//
// A new graph is opened by `openNewGraph` / `newGraph` (an import or Library
// open that opens a window, Plot in New Window, a drop on empty canvas, Quick
// Plot) or is the EMPTY startup window. It takes:
// - the template's chrome (`CHROME_KEYS`): tick formats, grid, frame, legend,
//   the plot template (font and base line width), axis-title fonts, gradient;
// - its per-position series styles, under the dataset's own (a parser's
//   scatter hint, technique memory).
// The window is then marked with the SEED it got (`templateSeeds`). Only a
// marked window ever sees the template again: a rebind takes the seed's series
// and resets tick formats to the seed's, and the edit check accepts the seeded
// look as fresh. Every other window -- a `.dwk` restore, a saved figure, a
// recipe, a recovered Origin graph, Graph Builder, a reimport, a split, and
// Window ▸ New Graph (a copy of the focused view) -- never reads it.
// Never taken at all: axis scales and X reversal (the dataset's technique
// defaults own them), limits, titles, bindings and Y3+ axes.
//
// Fails closed: a default that names no saved template (deleted, renamed,
// storage refused) applies NOTHING, and a toast says so; a template whose
// format this build cannot read applies its series styles only, and says so.
// The template is re-read when its storage changes, so re-saving it under the
// same name changes the default, as editing Origin's default template does.

import { loadGraphTemplates } from "./figuredoc";
import { captureGraphFormat, graphFormatPatch, sanitizeGraphFormat, seriesStyleFromExport } from "./graphFormat";
import { effectiveChannels } from "./plotdata";
import { defaultPlotView, snapshotView, type PlotView, type PlotWindow } from "./plotview";
import type { SeriesStyle } from "./seriesStyleTypes";
import type { Dataset } from "./types";
import { toast } from "../store/toasts";
import { useApp, type AppState } from "../store/useApp";
import { setNewGraphStyler, templateSeeds } from "../store/windowDefaults";
import { plotWindowDatasetId, plotWindowView, syncPlotWindow } from "../store/windowDocuments";
import { viewHasUserEdits } from "../store/windowUserEdits";

/** What a window was opened with: the chrome and the per-position series,
 *  with the two operations the eager store needs (so it never loads this
 *  module's code: a seed exists only once this module has made one). */
export interface TemplateSeed {
  chrome: Partial<PlotView>;
  series: (SeriesStyle | null)[];
  /** `view` (a fresh binding to `dataset`) as this seed opens it. */
  apply(view: PlotView, dataset: Dataset | undefined): PlotView;
  /** The per-channel series styles for a fresh binding `view` of `dataset`. */
  seriesFor(dataset: Dataset, view: Partial<PlotView>): Record<number, SeriesStyle>;
}

/** The view fields a default template seeds on a new graph. */
export const CHROME_KEYS = [
  "xFmt", "yFmt", "y2Fmt", "showGrid", "showAxisBox", "showLegend", "legendPos", "legendStatic",
  "plotTemplate", "axisLabelStyles", "seriesRamp",
] as const satisfies readonly (keyof PlotView)[];

/** The NAME of the saved graph template every new graph opens with; absent =
 *  none. Store-independent, like store/prefs.ts's small blobs. (Spelled out
 *  in commands/plotCommands.ts `warmDefaultGraphTemplate` too.) */
export const DEFAULT_GRAPH_TEMPLATE_KEY = "qz.defaultGraphTemplate";
const TEMPLATES_KEY = "qz.graphTemplates"; // lib/figuredoc.ts's store

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage unavailable: no default (fail closed)
  }
}

export function loadDefaultGraphTemplateName(): string | null {
  try {
    const raw = read(DEFAULT_GRAPH_TEMPLATE_KEY);
    const name: unknown = raw === null ? null : JSON.parse(raw);
    return typeof name === "string" && name.trim() ? name : null;
  } catch {
    return null; // damaged: no default (fail closed)
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

/** The chrome fields `view` sets (a format saved before gradients existed
 *  carries no `seriesRamp`: the built-in value stands). */
function pick(view: Partial<PlotView>): Partial<PlotView> {
  return Object.fromEntries(CHROME_KEYS.filter((k) => view[k] !== undefined).map((k) => [k, view[k]])) as Partial<PlotView>;
}

/** Why the default applies nothing or only part of itself (null = in full). */
type Resolved = { name: string; seed: TemplateSeed | null; problem: string | null };

/** Memoised on the two raw storage strings: the edit check runs this for every
 *  window on every passive import. */
let memo: { key: string; value: Resolved | null } | null = null;

/** The default, resolved: its seed, or why it has none. A template without its
 *  own `format` (saved before it existed, or an Origin .otp) restyles from its
 *  publication series styles over the built-in chrome -- as "Apply Graph
 *  Template…" does -- minus the grid, which it never chose. */
export function resolveDefault(): Resolved | null {
  const key = `${read(TEMPLATES_KEY)}\u0000${read(DEFAULT_GRAPH_TEMPLATE_KEY)}`;
  if (memo?.key === key) return memo.value;
  const name = loadDefaultGraphTemplateName();
  const template = name === null ? undefined : loadGraphTemplates().find((t) => t.name === name);
  let value: Resolved | null = null;
  if (name !== null && !template) {
    value = { name, seed: null, problem: `Default graph template "${name}" not found — new graphs open with the built-in look` };
  } else if (name !== null && template) {
    const own = sanitizeGraphFormat(template.format);
    const format = own ?? { ...captureGraphFormat(defaultPlotView(), []), series: (template.seriesStyles ?? []).map(seriesStyleFromExport) };
    const chrome = pick(graphFormatPatch(format, [], {}));
    if (!own) delete chrome.showGrid;
    const unreadable = template.format !== undefined && !own;
    value = {
      name,
      seed: makeSeed(chrome, format.series),
      problem: unreadable ? `Default graph template "${name}" was saved in a format this version cannot read — new graphs take its series styles only` : null,
    };
  }
  memo = { key, value };
  return value;
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

function makeSeed(chrome: Partial<PlotView>, series: (SeriesStyle | null)[]): TemplateSeed {
  const seriesFor = (dataset: Dataset, view: Partial<PlotView>): Record<number, SeriesStyle> => {
    const out: Record<number, SeriesStyle> = {};
    plottedChannels(dataset, view).forEach((ch, i) => {
      const style = series[i];
      if (style) out[ch] = structuredClone(style);
    });
    return out;
  };
  return {
    chrome,
    series,
    seriesFor,
    apply: (view, dataset) => ({
      ...view,
      ...structuredClone(chrome),
      seriesStyles: dataset ? { ...seriesFor(dataset, view), ...view.seriesStyles } : view.seriesStyles,
    }),
  };
}

const currentSeed = (): TemplateSeed | null => resolveDefault()?.seed ?? null;

/** What `win` shows now: the live singletons for the focused window. */
function viewOf(s: AppState, win: PlotWindow): PlotView {
  return win.id === s.focusedWindowId ? snapshotView(s) : plotWindowView(win);
}

/** Give every EMPTY graph -- a plot window with no data and no edits, like
 *  the window the app starts with -- the current default (or, with none, the
 *  built-in look), and mark it with its seed. A preference, not a document
 *  edit: no undo step. Idempotent (no write when nothing changes), so it also
 *  runs after every undo / redo, which restores window views but not the
 *  default (`watchHistory`). Anything with data or an edit is left alone. */
export function restyleEmptyGraphs(): void {
  const s = useApp.getState();
  const seed = resolveDefault()?.seed ?? null;
  const chrome = seed ? seed.chrome : { ...pick(defaultPlotView()), showGrid: s.defaultGrid };
  const changed = new Map<string, PlotView>();
  for (const w of s.plotWindows) {
    if (w.kind !== "plot" || plotWindowDatasetId(w) !== null) continue;
    const view = viewOf(s, w);
    if (viewHasUserEdits(view, undefined, templateSeeds.get(w.id))) continue;
    if (seed) templateSeeds.set(w.id, seed);
    else templateSeeds.delete(w.id);
    const next = { ...view, ...structuredClone(chrome) };
    if (JSON.stringify(pick(next)) !== JSON.stringify(pick(view))) changed.set(w.id, next);
  }
  if (changed.size === 0) return;
  const focused = s.focusedWindowId === null ? undefined : changed.get(s.focusedWindowId);
  useApp.setState({
    ...(focused ? pick(focused) : {}),
    plotWindows: s.plotWindows.map((w) => {
      const next = changed.get(w.id);
      return next ? syncPlotWindow(w, next) : w;
    }),
  });
}

let watching = false;
/** F4: an undo / redo restores an empty window's old look; put the default back. */
function watchHistory(): void {
  if (watching) return;
  watching = true;
  useApp.subscribe((s, prev) => {
    if (s.future !== prev.future) restyleEmptyGraphs();
  });
}

function install(): void {
  setNewGraphStyler(currentSeed);
  watchHistory();
  restyleEmptyGraphs();
  const problem = resolveDefault()?.problem;
  if (problem) toast(problem, "danger"); // a toast: the boot's later status lines would hide a status
}

/** Boot (commands/plotCommands.ts `warmDefaultGraphTemplate`): fill the slot. */
export function installDefaultGraphTemplate(): void {
  install();
}

/** Make the saved template `name` (null = none) the default for new graphs. */
export function setDefaultGraphTemplate(name: string | null): void {
  saveDefaultGraphTemplateName(name);
  install();
}
