// Stage-side graph templates and Copy/Paste Format (figures-audit B2): the
// Plot menu's "Save Graph Template…", "Apply Graph Template…", "Copy Format"
// and "Paste Format". Loaded on demand (`commands/plotCommands.ts` reaches it
// through `runLazy`), so none of it costs the eager bundle.
//
// A template here is the SAME `GraphTemplate` record the Publication preview
// saves (`lib/figuredoc.ts`, localStorage `qz.graphTemplates`), so a template
// saved in either place is listed and applied in both: the Stage writes its
// `format` (`lib/graphFormat.ts`) plus the export-wire `seriesStyles`; the
// preview applies `style`/`overrides`/`seriesStyles` and the Stage `format`.
// Style only, never data: no channel binding, limit or title travels.

import { askConfirm } from "../store/confirmDialog";
import { askParams } from "../store/paramDialog";
import { templateSeeds } from "../store/windowDefaults";
import { loadDefaultGraphTemplateName, plottedChannels, setDefaultGraphTemplate } from "./defaultGraphTemplate";
import type { StoreGet } from "./exportActive";
import { buildExportStyles } from "./exportStyles";
import { loadGraphTemplates, saveGraphTemplate, type GraphTemplate } from "./figuredoc";
import {
  captureGraphFormat,
  graphFormatPatch,
  sanitizeGraphFormat,
  seriesStyleFromExport,
  type GraphFormat,
} from "./graphFormat";
import { applyFormatToGraphs, GRAPH_SCOPES, type GraphScope } from "./graphFormatBulk";
import { formatAxisOrphans } from "./graphFormatMultiY";
import type { PlotView } from "./plotview";
import { recordUse } from "./recipeIndex";
import { useApp } from "../store/useApp";

/** The session's format clipboard -- one slot, like Origin's. */
let copiedFormat: GraphFormat | null = null;

/** Test-only: empty the format clipboard. */
export function resetCopiedFormatForTests(): void {
  copiedFormat = null;
}

/** The focused graph's plotted series in display order, or null (with a
 *  status message) when no dataset is plotted. */
function plottedSeries(s: StoreGet, verb: string): number[] | null {
  const state = s();
  const dataset = state.datasets.find((d) => d.id === state.activeId);
  if (!dataset) {
    state.setStatus(`${verb} unavailable: no plotted dataset`);
    return null;
  }
  return plottedChannels(dataset, state);
}

/** Restyle the focused graph with `format`, as ONE undo step. */
function applyFormat(s: StoreGet, format: GraphFormat, label: string): boolean {
  const plotted = plottedSeries(s, label);
  if (!plotted) return false;
  s().recordHistory(label.toLowerCase());
  useApp.setState(graphFormatPatch(format, plotted, s().seriesStyles, s()));
  // Fail closed (gap audit 4 G11): a position on an axis the format lacks drew on Y1 -- say so.
  const lost = formatAxisOrphans(format);
  if (lost) s().setStatus(`${label}: ${lost} series assigned to a Y axis the format does not have — drawn on Y1`);
  return !lost;
}

export function copyStageFormat(s: StoreGet): void {
  const plotted = plottedSeries(s, "Copy Format");
  if (!plotted) return;
  copiedFormat = captureGraphFormat(s(), plotted);
  s().setStatus("graph format copied — use Paste Format on another graph");
}

export function pasteStageFormat(s: StoreGet): void {
  if (!copiedFormat) {
    s().setStatus("Paste Format: nothing copied yet — use Copy Format on a styled graph first");
    return;
  }
  if (applyFormat(s, copiedFormat, "Paste Format")) s().setStatus("graph format pasted");
}

/** A template's Stage format: its own when it has one, else one derived
 *  from its publication series styles (a template saved before `format`
 *  existed, or imported from an Origin .otp) over the CURRENT chrome. */
export function templateFormat(template: GraphTemplate, s: StoreGet, plotted: readonly number[]): GraphFormat {
  return templateFormatFor(template, s(), plotted);
}

function templateFormatFor(template: GraphTemplate, view: Parameters<typeof captureGraphFormat>[0], plotted: readonly number[]): GraphFormat {
  const own = sanitizeGraphFormat(template.format);
  if (own) return own;
  const base = captureGraphFormat(view, plotted);
  return { ...base, series: (template.seriesStyles ?? []).map(seriesStyleFromExport) };
}

// The select shows (and answers with) each scope's label.
const SCOPE_FIELD = { key: "scope", label: "Apply to", type: "select" as const, default: GRAPH_SCOPES[0].label, options: GRAPH_SCOPES.map((o) => o.label) };
const scopeOf = (answer: unknown): GraphScope => GRAPH_SCOPES.find((o) => o.label === answer)?.value ?? "folder";

function reportMany(s: StoreGet, n: number, what: string, format?: GraphFormat | null): void {
  // Fail closed (gap audit 4 G11): positions on a Y axis the format lacks drew on Y1 -- say so here too.
  const lost = n && format ? formatAxisOrphans(format) : 0;
  const onY1 = lost ? ` -- ${lost} series per graph on a Y axis the format does not have, drawn on Y1` : "";
  s().setStatus(n === 0 ? `${what}: no open graph matches -- open the graphs first, or pick another scope` : `${what}: ${n} graph${n === 1 ? "" : "s"} restyled (one undo step)${onY1}`);
}

/** Gap-audit-2 #13: Paste Format onto every graph of a folder / selection. */
export async function pasteFormatToGraphs(s: StoreGet): Promise<void> {
  const format = copiedFormat;
  if (!format) {
    s().setStatus("Paste Format: nothing copied yet — use Copy Format on a styled graph first");
    return;
  }
  const params = await askParams("Paste Format to Graphs", [SCOPE_FIELD], { confirmLabel: "Paste" });
  if (!params) return;
  reportMany(s, applyFormatToGraphs(s, scopeOf(params.scope), () => format, "Paste Format to graphs"), "Paste Format", format);
}

/** Gap-audit-2 #13: a graph template onto every graph of a folder / selection. */
export async function applyGraphTemplateToGraphs(s: StoreGet): Promise<void> {
  const templates = loadGraphTemplates();
  if (templates.length === 0) {
    s().setStatus("Apply Graph Template: no saved templates yet — use Save Graph Template… first");
    return;
  }
  const params = await askParams("Apply Graph Template to Graphs", [
    { key: "name", label: "Template", type: "select", default: templates[0].name, options: templates.map((t) => t.name) },
    SCOPE_FIELD,
  ], { confirmLabel: "Apply" });
  const template = params && templates.find((t) => t.name === params.name);
  if (!params || !template) return;
  recordUse({ kind: "graph", scope: "global", id: template.name });
  const n = applyFormatToGraphs(s, scopeOf(params.scope), (view: PlotView, plotted) => templateFormatFor(template, view, plotted), `Apply Graph Template "${template.name}" to graphs`);
  reportMany(s, n, `Graph template "${template.name}"`, sanitizeGraphFormat(template.format));
}

/** Ask for a name and save the focused graph's style under it; the name, or
 *  null when nothing was saved. */
async function saveFocusedAsTemplate(s: StoreGet, title: string, name: string, confirmLabel: string): Promise<string | null> {
  const plotted = plottedSeries(s, title);
  if (!plotted) return null;
  const params = await askParams(title, [
    { key: "name", label: "Template name", type: "text", default: name },
  ], { confirmLabel });
  const picked = params ? String(params.name).trim() : "";
  if (!picked) return null;
  // Never replace a saved template silently (gap audit 5 review F9).
  if (loadGraphTemplates().some((t) => t.name === picked)
    && !(await askConfirm(`Replace graph template "${picked}"?`, "A saved graph template already has this name. Replacing it changes every graph that uses it as the default.", "Replace"))) return null;
  const state = s();
  saveGraphTemplate({
    name: picked,
    style: "default",
    overrides: null,
    seriesStyles: buildExportStyles(plotted, state.seriesStyles),
    format: captureGraphFormat(state, plotted),
  });
  return picked;
}

export async function saveStageGraphTemplate(s: StoreGet): Promise<void> {
  const name = await saveFocusedAsTemplate(s, "Save Graph Template", "My graph style", "Save");
  if (name) s().setStatus(`graph template "${name}" saved`);
}

/** Gap audit 5 #1: Origin's "set as default" -- save the focused graph's
 *  style as a template and open every NEW graph with it (lib/defaultGraphTemplate.ts). */
export async function setStageGraphAsDefault(s: StoreGet): Promise<void> {
  const name = await saveFocusedAsTemplate(s, "Set as Default for New Graphs", loadDefaultGraphTemplateName() ?? "Default graph", "Set as default");
  if (!name) return;
  // The source graph is the user's own style now, not a new graph: unmark it
  // so it stays protected from a passive rebind (review F1).
  templateSeeds.delete(s().focusedWindowId ?? "");
  setDefaultGraphTemplate(name);
  // Fail closed: the default never assigns Y3+ axes (lib/defaultGraphTemplate.ts) -- say so.
  const extra = s().yAxes.length ? "; its Y3+ axes are not applied to new graphs" : "";
  s().setStatus(`graph template "${name}" saved — new graphs open with it (Preferences ▸ Plot to change)${extra}`);
}

export async function applyStageGraphTemplate(s: StoreGet): Promise<void> {
  const templates = loadGraphTemplates();
  if (templates.length === 0) {
    s().setStatus("Apply Graph Template: no saved templates yet — use Save Graph Template… first");
    return;
  }
  const params = await askParams("Apply Graph Template", [
    { key: "name", label: "Template", type: "select", default: templates[0].name, options: templates.map((t) => t.name) },
  ], { confirmLabel: "Apply" });
  if (!params) return;
  const template = templates.find((t) => t.name === params.name);
  const plotted = plottedSeries(s, "Apply Graph Template");
  if (!template || !plotted) return;
  recordUse({ kind: "graph", scope: "global", id: template.name });
  if (applyFormat(s, templateFormat(template, s, plotted), "Apply Graph Template")) {
    s().setStatus(`graph template "${template.name}" applied`);
  }
}
export { contourFromScattered } from "./scatteredContour";
export { editExtraYAxes } from "./multiYCommands"; // Plot ▸ Y Axis Settings… (gap audit 4 G11)
export { installDefaultGraphTemplate } from "./defaultGraphTemplate"; // the boot (commands/plotCommands.ts warmDefaultGraphTemplate)
