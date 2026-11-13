// The worksheet column menu's "Set As" (Origin's Column > Set As: X, Y, Z,
// Y Error, X Error, Label, Disregard). LAZY: the menu imports this module
// only when an entry is picked (components/Stage/worksheet/worksheetMenus.ts),
// so none of it reaches the eager bundle.
//
// One undoable step writes every field the choice touches, so the plot and
// the exports honour it through the paths they already read:
//  - `Dataset.columnDesignations`: the persisted map itself (round-trips
//    .dwk, sanitized on load) -- the plotting defaults read it through
//    lib/columnmeta.ts (hidden channels, nearest-preceding-X).
//  - `Dataset.channelRoles`: Label -> "label", Disregard -> "ignore" (the
//    plot, figure export and worksheet statistics already honour these).
//  - `Dataset.errorRoles`: Y Error binds the column to the nearest preceding
//    Y; X Error to the Y it follows (Origin's rule, lib/originBookRoles.ts),
//    else the shared X axis. Every other choice drops the column's bindings
//    and, when it stops being a Y, any binding that targeted it. The Origin
//    exports read these as `metadata.error_roles`, and the map itself as
//    `metadata.user_column_designations` (commands/fileCommandsLazy.ts ->
//    src/quantized/io/_error_roles.py: X / Z / Label / Disregard columns).
//  - the live plot's hidden channels and legacy `errKeys` when the dataset is
//    the active one, so the change shows at once.

import { SET_AS_CHOICES } from "../lib/setAsChoices";
import { effectiveDesignations, type ColumnDesignations, type OriginDesignation } from "../lib/columnmeta";
import { bookDefaultHiddenChannels, defaultErrKeys } from "../lib/errorbars";
import { errKeysFromBindings, figureSeedErrorBindings, type ErrorBinding } from "../lib/errorRoles";
import type { ChannelRole, Dataset } from "../lib/types";
import { useApp } from "./useApp";
import { syncDatasetWindowDocuments } from "./windowDocuments";

const isErrorish = (d: OriginDesignation | undefined) =>
  d === "Y-error" || d === "X-error" || d === "label" || d === "disregard" || d === "X";

/** The error binding a Y Error / X Error choice makes, or null when there is
 *  nothing it can describe (no Y before it). Pure. */
export function designationBinding(
  designations: readonly (OriginDesignation | undefined)[],
  channel: number,
  designation: OriginDesignation,
  taken: ReadonlySet<number>,
): ErrorBinding | null {
  const isY = (c: number) => !taken.has(c) && !isErrorish(designations[c]);
  if (designation === "Y-error") {
    for (let c = channel - 1; c >= 0; c--) if (isY(c)) return { channel, target: c, axis: "y", side: "both" };
    return null;
  }
  if (designation !== "X-error") return null;
  // The Y it follows inside its own X block; with none, the shared X axis --
  // but only while no secondary X precedes it (then it is that X's, which no
  // binding can express without a Y).
  let sawX = false;
  for (let c = channel - 1; c >= 0; c--) {
    if (designations[c] === "X") {
      sawX = true;
      break;
    }
    if (isY(c)) return { channel, target: c, axis: "x", side: "both" };
  }
  return sawX ? null : { channel, target: -1, axis: "x", side: "both" };
}

/** The dataset fields one Set As choice writes. Pure (no store access). */
export function applyDesignation(
  ds: Dataset,
  channel: number,
  designation: OriginDesignation,
): Pick<Dataset, "columnDesignations" | "channelRoles" | "errorRoles"> & { paired: boolean } {
  const columnDesignations: ColumnDesignations = { ...ds.columnDesignations, [channel]: designation };
  const designations = effectiveDesignations(ds.data, columnDesignations);

  const roles: Record<number, ChannelRole> = { ...ds.channelRoles };
  delete roles[channel];
  if (designation === "label") roles[channel] = "label";
  if (designation === "disregard") roles[channel] = "ignore";

  const stillY = designation === "Y" || designation === "Z";
  let errorRoles = figureSeedErrorBindings(ds).filter(
    (b) => b.channel !== channel && (stillY || b.target !== channel),
  );
  // Neither an error column nor a label/ignore column can be the Y it pairs with.
  const taken = new Set([...errorRoles.map((b) => b.channel), ...Object.keys(roles).map(Number)]);
  const binding = designationBinding(designations, channel, designation, taken);
  if (binding) errorRoles = [...errorRoles, binding];
  return {
    columnDesignations,
    channelRoles: Object.keys(roles).length ? roles : undefined,
    errorRoles,
    paired: binding !== null || (designation !== "Y-error" && designation !== "X-error"),
  };
}

/** Set `channel` of dataset `id` as `designation` -- one undoable step. */
export function setColumnDesignation(id: string, channel: number, designation: OriginDesignation): void {
  const state = useApp.getState();
  const ds = state.datasets.find((d) => d.id === id);
  if (!ds || channel < 0 || channel >= ds.data.labels.length) return;
  const { paired, ...patch } = applyDesignation(ds, channel, designation);
  const name = ds.data.labels[channel] ?? `column ${channel + 1}`;
  const label = SET_AS_CHOICES.find(([d]) => d === designation)?.[1] ?? designation;
  state.recordHistory(`set ${name} as ${label}`);
  const next: Dataset = { ...ds, ...patch };
  useApp.setState((s) => {
    const live = s.activeId === id;
    // The live plot: swap the old defaults for the new ones, keeping any
    // channel the user hid by hand.
    const oldDefault = new Set(bookDefaultHiddenChannels(ds));
    // A column set as Y or Z is a curve again, whatever hid it before (an
    // inferred error binding hides its column without any designation).
    if (designation === "Y" || designation === "Z") oldDefault.add(channel);
    const hidden = live
      ? [...new Set([...s.hiddenChannels.filter((c) => !oldDefault.has(c)), ...bookDefaultHiddenChannels(next)])]
      : s.hiddenChannels;
    const errKeys = live
      ? { ...defaultErrKeys(next.data, next.columnDesignations), ...errKeysFromBindings(next.errorRoles ?? []) }
      : s.errKeys;
    return {
      datasets: s.datasets.map((d) => (d.id === id ? next : d)),
      plotWindows: syncDatasetWindowDocuments(s.plotWindows, id, next.errorRoles),
      hiddenChannels: hidden.sort((a, b) => a - b),
      errKeys,
      status: paired
        ? `set ${name} as ${label}`
        : `set ${name} as ${label} — ${designation === "X-error" ? "no Y in its X block" : "no Y before it"} to attach to; exported as an unbound error column`,
    };
  });
}
