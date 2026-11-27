// Plot setup (plan item 43): the role grid's model. One grid at plot time, a
// row per worksheet column, each carrying at most one of X / Y / Y error /
// X error / Label, chosen for THIS plot and independent of the column
// designations (the worksheet's "Set As" is never read or written here beyond
// seeding the first guess).
//
// It reuses the plot's existing role model rather than a parallel one: X and
// Y are the store's `xKey` / `yKeys`, the two error roles are the dataset's
// canonical `ErrorBinding`s (lib/errorRoles.ts, paired by the same
// nearest-preceding rule as Set As -- `designationBinding`), and Label is the
// plot's `pointLabels`. This module only DECIDES (pure); components/overlays/figuredialogs/plotSetupApply.ts
// writes the plan through the store actions, and the lazy dialog draws it.
//
// Channel numbering is the worksheet's: -1 is the pinned x/time column (the
// dataset's own X), 0..n-1 are value channels.

import { effectiveDesignations, type OriginDesignation } from "./columnmeta";
import { figureSeedErrorBindings, type ErrorBinding } from "./errorRoles";
import { effectiveChannels } from "./plotdata";
import type { PointLabels } from "./pointLabels";
import type { Dataset } from "./types";
import { designationBinding } from "../store/columnDesignationActions";

export type PlotRole = "x" | "y" | "yErr" | "xErr" | "label";
/** channel -> role; a channel absent from the map is not used by the plot. */
export type RoleMap = Readonly<Record<number, PlotRole>>;

export const OWN_X = -1;

/** What the dialog is opened with: the plot's live roles (no `cols`), or a
 *  worksheet selection that "Plot selection" could not place unambiguously. */
export interface PlotSetupSeed {
  datasetId: string;
  cols?: readonly number[];
  mode?: "replace" | "add";
}

/** The live plot's choices the grid starts from. */
export interface LivePlot {
  xKey: number | null;
  yKeys: number[] | null;
  pointLabels: PointLabels | null;
}

const ERROR_CHANNELS = (roles: readonly ErrorBinding[]): Set<number> => new Set(roles.map((b) => b.channel));

/** The grid for the plot as it is now: its X, its plotted Ys (never an error
 *  column), the dataset's error roles and the point-label column. */
export function liveRoles(ds: Dataset, live: LivePlot): Record<number, PlotRole> {
  const bindings = figureSeedErrorBindings(ds);
  const errors = ERROR_CHANNELS(bindings);
  const n = ds.data.labels.length;
  const out: Record<number, PlotRole> = { [live.xKey ?? OWN_X]: "x" };
  for (const c of effectiveChannels(ds.data, live.yKeys, live.xKey, ds.channelRoles)) {
    if (!errors.has(c) && c < n) out[c] = "y";
  }
  for (const b of bindings) if (b.channel < n && !(b.channel in out)) out[b.channel] = b.axis === "y" ? "yErr" : "xErr";
  const label = live.pointLabels;
  if (label && !label.text && label.key >= 0 && label.key < n && !(label.key in out)) out[label.key] = "label";
  return out;
}

/** The first guess for a worksheet selection: each selected column takes the
 *  role its designation names (X / Y error / X error / Label; a Y or an
 *  undesignated column is a Y; Disregard and the factor columns are left out).
 *  The pinned x column selected means the dataset's own X. Every other column
 *  keeps what the plot has now in "add" mode and nothing in "replace" mode, so
 *  the X is left for the user to choose -- never guessed. */
export function selectionRoles(ds: Dataset, live: LivePlot, cols: readonly number[], mode: "replace" | "add"): Record<number, PlotRole> {
  const desig = effectiveDesignations(ds.data, ds.columnDesignations);
  const bindings = figureSeedErrorBindings(ds);
  const out: Record<number, PlotRole> = mode === "add" ? { ...liveRoles(ds, live) } : {};
  if (mode === "replace") {
    // The error and label roles already in force stay on their columns.
    for (const b of bindings) out[b.channel] = b.axis === "y" ? "yErr" : "xErr";
  }
  const n = ds.data.labels.length;
  for (const c of cols) {
    if (c === OWN_X) {
      out[OWN_X] = "x";
      continue;
    }
    if (c < 0 || c >= n) continue;
    const d: OriginDesignation | undefined = desig[c];
    if (d === "disregard" || d === "group" || d === "subject") delete out[c];
    else if (d === "X") out[c] = "x";
    else if (d === "Y-error") out[c] = "yErr";
    else if (d === "X-error") out[c] = "xErr";
    else if (d === "label") out[c] = "label";
    else out[c] = "y";
  }
  return out;
}

/** `roles` with `channel` given `role` (null = unused). X and Label are single
 *  slots: giving one to a column takes it from the column that held it. */
export function withRole(roles: RoleMap, channel: number, role: PlotRole | null): Record<number, PlotRole> {
  const out: Record<number, PlotRole> = { ...roles };
  if (role === "x" || role === "label") for (const [k, r] of Object.entries(out)) if (r === role) delete out[Number(k)];
  if (role === null) delete out[channel];
  else out[channel] = role;
  return out;
}

const SYNTH: Record<PlotRole, OriginDesignation> = { x: "X", y: "Y", yErr: "Y-error", xErr: "X-error", label: "label" };

/** The roles as designations (index-aligned with the value channels), so the
 *  error pairing is `designationBinding`'s own -- an unused column counts as
 *  Disregard and is never the Y an error attaches to. */
function synthDesignations(n: number, roles: RoleMap): OriginDesignation[] {
  return Array.from({ length: n }, (_, c) => (roles[c] ? SYNTH[roles[c]] : "disregard"));
}

/** An existing binding still stands when its error column keeps the same
 *  axis's error role (`roles[channel]` unchanged, or re-picked the same). */
const keeps = (b: ErrorBinding, roles: RoleMap): boolean => roles[b.channel] === (b.axis === "y" ? "yErr" : "xErr");

export interface PlotSetupPlan {
  /** null = the dataset's own X. */
  xKey: number | null;
  yKeys: number[];
  /** The dataset's complete error roles, or null when this plan leaves them as they are. */
  errorRoles: ErrorBinding[] | null;
  /** The bindings the user newly set here: recorded as confirmed (an explicit decision). */
  decided: ErrorBinding[];
  /** The point-label column, or "keep" (nothing chosen and a text-column label stays). */
  label: number | null | "keep";
}

export interface PlotSetupResult {
  plan: PlotSetupPlan | null;
  /** Why the grid cannot be applied; empty when `plan` is set. */
  problems: string[];
}

/** Turn the grid into the plan the store writes, or say what is missing.
 *  Fails closed: no X, no Y or an error column with nothing to describe is a
 *  problem, never a guess. Existing error bindings on columns whose role is
 *  unchanged are carried verbatim (asymmetric halves, Origin-written marks),
 *  including those of a Y this plot no longer draws, so a replace-style plot
 *  never deletes the dataset's other errors. */
export function planPlotSetup(ds: Dataset, roles: RoleMap, pointLabels: PointLabels | null): PlotSetupResult {
  const n = ds.data.labels.length;
  const name = (c: number) => ds.data.labels[c] ?? `column ${c + 1}`;
  const problems: string[] = [];
  const entries = Object.entries(roles).map(([k, r]) => [Number(k), r] as const).filter(([c]) => c === OWN_X || (c >= 0 && c < n));
  const xs = entries.filter(([, r]) => r === "x").map(([c]) => c);
  if (xs.length === 0) problems.push("Choose an X column (or the sheet's own X).");
  if (xs.length > 1) problems.push("Only one column can be X.");
  const yKeys = entries.filter(([c, r]) => r === "y" && c >= 0).map(([c]) => c).sort((a, b) => a - b);
  if (yKeys.length === 0) problems.push("Choose at least one Y column.");
  if (entries.some(([c, r]) => c === OWN_X && r !== "x")) problems.push("The sheet's own X can only be X.");

  const existing = figureSeedErrorBindings(ds);
  const kept = existing.filter((b) => keeps(b, roles));
  const taken = new Set([...kept.map((b) => b.channel), ...entries.filter(([, r]) => r !== "y" && r !== "x").map(([c]) => c)]);
  const designations = synthDesignations(n, roles);
  const added: ErrorBinding[] = [];
  for (const [c, r] of entries) {
    if (c < 0 || (r !== "yErr" && r !== "xErr") || kept.some((b) => b.channel === c)) continue;
    const binding = designationBinding(designations, c, r === "yErr" ? "Y-error" : "X-error", taken);
    if (binding) added.push(binding);
    else problems.push(r === "yErr" ? `${name(c)} is a Y error column with no Y before it.` : `${name(c)} is an X error column with no Y in its X block to describe.`);
  }
  const next = [...kept, ...added];
  const same = next.length === existing.length && next.every((b) => existing.some((e) => JSON.stringify(e) === JSON.stringify(b)));

  const labelCh = entries.find(([, r]) => r === "label")?.[0];
  const label = labelCh !== undefined ? labelCh : pointLabels?.text ? "keep" : null;
  if (problems.length > 0) return { plan: null, problems };
  return { plan: { xKey: xs[0] === OWN_X ? null : xs[0], yKeys, errorRoles: same ? null : next, decided: added, label }, problems };
}
