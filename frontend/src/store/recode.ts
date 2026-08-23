// J2 Recode workshop (JMP_GAP_PLAN item 2 / PRIMARY P1.6b's booked worksheet
// categorical UI). A STANDALONE Zustand store — the store/relink.ts /
// store/fitYByX.ts precedent — rather than composed into useApp.ts: that
// store sits close to its size-ratchet pin (architecture.test.ts's
// STORE_PINS, shared across every lane landing this sprint week), and none
// of THIS panel's own open/draft-mapping/saved-mappings state needs to
// round-trip `.dwk` today (see the SAVED MAPPINGS note below for why not).
// Mutations to a dataset's `formulas` go through `useApp.getState()`
// directly (recordHistory + set), the same "standalone store, direct
// useApp.getState() calls" shape store/relink.ts already uses.
//
// THE RECODED COLUMN ITSELF, once committed, is an ordinary
// `Dataset.formulas` entry with `.recode` set (lib/recode.ts's `RecodeSpec`)
// — it round-trips `.dwk` for free (workspace.ts's existing formulas
// pass-through, unchanged) and participates in the K3/K4 recalc graph
// (col->col deps, cycle rejection) the SAME way a plain formula column does,
// because it IS one; see lib/formula.ts's `computeFormulas` for the
// `f.recode` branch that computes it instead of compiling `f.expr`.
//
// SAVED MAPPINGS (J2 item 3: "saveable and re-applicable to another
// column/dataset") are SESSION-ONLY for this slice — lost on reload. Not a
// convenience choice: `lib/workspace.ts` sits at 595/600 of its own
// architecture.test.ts pin (5 lines of headroom), and the established
// pattern for a NEW persisted list (WorkspaceState field + LoadedWorkspace
// field + WorkspaceDoc field + serializer default + parseWorkspace sanitize
// call — see that file's TS_MODULE_PINS comment history, e.g. the
// `quickPlotTemplates` hook-in) costs 4-5 lines there alone. Deferred, named
// home: the next slice that earns workspace.ts headroom (an extraction, not
// a bump) should wire `savedRecodeMappings` in exactly that shape.
// RecodePanel.tsx's Save control + the saved-mapping list both visibly
// disclose the session-only limitation in the UI (adversarial review P1) —
// don't remove that disclosure without landing real persistence first.
//
// CLOSED (Sol audit P1-3, DEFECT B — was BOOKED, not fixed, per the prior
// note below): the non-modal RecodePanel keeps `channel` as a plain index
// while the panel is open — if the SAME dataset's columns shift underneath
// it mid-edit (a formula/recode column removed elsewhere, a reimport) the
// panel could silently end up pointed at a DIFFERENT column than the one
// the user opened it on. `openRecode` now also captures the column's LABEL
// (`openLabel`) and LETTER (`openLetter`) at open time — a stable identity
// independent of position. `commitRecode` re-resolves that identity against
// the dataset's CURRENT labels via `lib/recode.ts`'s `resolveRecodeChannel`
// before trusting `channel` at all: unchanged if the label still matches,
// silently RETARGETS `channel` to the column that now carries `openLabel`
// if exactly one does, or REFUSES the commit (toast naming the column,
// panel stays open, draft intact) if that label is gone or now ambiguous.
// `activeRecodePreview` resyncs the same way, returning null rather than
// reading a column the panel didn't open on.

import { create } from "zustand";

import { withRecomputedFormulas, formulaLetter } from "./computedColumns";
import { categoricalLevels, isCategoricalChannel } from "../lib/categorical";
import { baseColumns, channelLetter } from "../lib/formula";
import { recalcNodes, wouldCreateCycle } from "../lib/recalc";
import {
  buildRecodePreview,
  mappingFromFindReplace,
  resolveRecodeChannel,
  resolveRecodeMapping,
  type RecodeGroup,
  type RecodeMapping,
  type SavedRecodeMapping,
} from "../lib/recode";
import type { ComputedColumn } from "../lib/types";
import { toast } from "./toasts";
import { useApp } from "./useApp";

let _savedSeq = 0;
const nextSavedId = (): string => `recode-${Date.now().toString(36)}-${++_savedSeq}`;

interface RecodeState {
  open: boolean;
  datasetId: string | null;
  channel: number | null;
  /** DEFECT B: the column's identity AS OF OPEN TIME, independent of
   *  `channel`'s position — `commitRecode` re-resolves `channel` against
   *  `openLabel` before trusting it. `openLetter` is carried for messaging/
   *  debugging symmetry (`channel`'s letter form) but is not itself part of
   *  the identity check (it's channel-index-derived, so by definition it
   *  never matches the shifted position). */
  openLabel: string | null;
  openLetter: string | null;
  mapping: RecodeMapping;
  newColumnName: string;
  savedMappings: SavedRecodeMapping[];

  /** Open the workshop on `channel` of `datasetId` — refuses (toast, stays
   *  closed) when the column isn't categorical, mirroring every other
   *  refusal-with-explanation in this codebase rather than opening onto a
   *  column the commit step would reject anyway. */
  openRecode: (datasetId: string, channel: number) => void;
  closeRecode: () => void;
  setNewColumnName: (name: string) => void;
  /** Replace the draft mapping wholesale (the preview table's live-edit
   *  entry point — see components/workshops/recode's view for the group
   *  editing UI built on top of this + `buildRecodePreview`). */
  setMapping: (mapping: RecodeMapping) => void;
  /** Merge/rename: fold `levels` into one group producing `newLabel`,
   *  replacing any EARLIER group membership those levels had (a level
   *  belongs to at most one group at a time — reassigning it moves it, it
   *  never joins two groups). */
  setGroup: (newLabel: string, levels: string[]) => void;
  /** Revert `oldLevel` to identity (remove it from whichever group, if any,
   *  currently claims it). */
  clearLevel: (oldLevel: string) => void;
  /** J2's "plain find-replace over text cells": REPLACES the whole draft
   *  mapping with the one `mappingFromFindReplace` builds against the
   *  column's CURRENT levels — a deliberate one-shot generator, not a merge
   *  with hand-made groups (composing the two has no single obvious
   *  meaning; find-replace again from a clean slate does). */
  applyFindReplace: (find: string, replace: string, caseSensitive?: boolean) => void;
  /** Commit the draft mapping as a new derived (computed) column on the
   *  source dataset — ONE undo entry, provenance recorded via
   *  `ComputedColumn.recode`. Refuses (toast, zero mutation) when the
   *  source is no longer categorical or the edge would create a cycle
   *  (K4). Closes the panel and returns the new column's letter on
   *  success, null on refusal. */
  commitRecode: () => string | null;
  /** Save the CURRENT draft mapping for later reuse elsewhere. */
  saveMapping: (name: string) => void;
  deleteMapping: (id: string) => void;
  /** Reapply a saved mapping to the PANEL'S CURRENTLY OPEN column/dataset
   *  (which may be a different one than it was built against) — refuses
   *  with every unmatched level named (`resolveRecodeMapping`) rather than
   *  a partial apply. On success, loads the mapping into the draft (it
   *  still requires an explicit Commit — applying never auto-commits). */
  applySavedMapping: (id: string) => void;
}

export const useRecode = create<RecodeState>((set, get) => ({
  open: false,
  datasetId: null,
  channel: null,
  openLabel: null,
  openLetter: null,
  mapping: { groups: [] },
  newColumnName: "",
  savedMappings: [],

  openRecode: (datasetId, channel) => {
    const ds = useApp.getState().datasets.find((d) => d.id === datasetId);
    if (!ds || !isCategoricalChannel(ds.data, channel)) {
      toast(`"${ds?.data.labels[channel] ?? "that column"}" isn't categorical — Recode needs a level table.`, "danger");
      return;
    }
    set({
      open: true,
      datasetId,
      channel,
      openLabel: ds.data.labels[channel],
      openLetter: channelLetter(channel),
      mapping: { groups: [] },
      newColumnName: `${ds.data.labels[channel]} (recoded)`,
    });
  },
  closeRecode: () =>
    set({ open: false, datasetId: null, channel: null, openLabel: null, openLetter: null, mapping: { groups: [] } }),
  setNewColumnName: (name) => set({ newColumnName: name }),
  setMapping: (mapping) => set({ mapping }),
  setGroup: (newLabel, levels) => {
    const claimed = new Set(levels);
    const groups: RecodeGroup[] = get()
      .mapping.groups.map((g) => ({ ...g, from: g.from.filter((l) => !claimed.has(l)) }))
      .filter((g) => g.from.length > 0);
    groups.push({ newLabel, from: levels });
    set({ mapping: { groups } });
  },
  clearLevel: (oldLevel) => {
    const groups = get()
      .mapping.groups.map((g) => ({ ...g, from: g.from.filter((l) => l !== oldLevel) }))
      .filter((g) => g.from.length > 0);
    set({ mapping: { groups } });
  },
  applyFindReplace: (find, replace, caseSensitive) => {
    const { datasetId, channel } = get();
    const ds = datasetId != null ? useApp.getState().datasets.find((d) => d.id === datasetId) : undefined;
    const levels = ds && channel != null ? categoricalLevels(ds.data, channel) : null;
    if (!levels) return;
    set({ mapping: mappingFromFindReplace(levels, find, replace, { caseSensitive }) });
  },

  commitRecode: () => {
    const { datasetId, channel, mapping, newColumnName, openLabel } = get();
    if (datasetId == null || channel == null || openLabel == null) return null;
    const app = useApp.getState();
    const ds = app.datasets.find((d) => d.id === datasetId);
    if (!ds) {
      toast("can't recode: dataset not found", "danger");
      return null;
    }
    // DEFECT B (Sol audit P1-3): `channel` is a plain index that can have
    // gone stale (a column removed/reimported elsewhere) since `openRecode`
    // captured it — re-resolve the LABEL identity before trusting it at all.
    // A resolved retarget updates `channel` in the panel state too, so the
    // rest of this function (and every later read of `get().channel`) sees
    // the corrected index; a refusal returns with the draft untouched.
    const resolved = resolveRecodeChannel(ds.data.labels, channel, openLabel);
    if (!resolved.ok) {
      toast(resolved.reason, "danger");
      return null;
    }
    const resolvedChannel = resolved.channel;
    if (resolvedChannel !== channel) set({ channel: resolvedChannel });
    if (!isCategoricalChannel(ds.data, resolvedChannel)) {
      toast(`can't recode "${ds.data.labels[resolvedChannel]}": no longer categorical`, "danger");
      return null;
    }
    const name = newColumnName.trim() || `${ds.data.labels[resolvedChannel]} (recoded)`;
    const sourceLetter = channelLetter(resolvedChannel);
    const target = formulaLetter(ds.data.labels.length, ds.formulas?.length ?? 0, ds.formulas?.length ?? 0);
    // Adversarial review P3: this branch is UNREACHABLE at this call site
    // today (mutation-deleting it produces zero test failures) — `target`
    // is the letter the BRAND-NEW column is about to occupy, so nothing in
    // the graph can already reference it, and `sourceLetter -> target` is a
    // fresh edge that can't close an existing cycle either. Kept anyway,
    // deliberately: it mirrors `computedColumns.ts`'s `addFormula`, which
    // has the EXACT same property and the SAME accepted-pattern reasoning
    // there (a real cycle risk only exists for `updateFormula`, editing an
    // EXISTING column's deps) — consistency with that precedent, and a
    // guard against this function's shape changing later, not a currently-
    // exercised safety net. Do not read its presence as evidence this path
    // is tested.
    const reason = wouldCreateCycle(app.datasets, {
      from: recalcNodes.column(datasetId, sourceLetter),
      to: recalcNodes.column(datasetId, target),
    });
    if (reason) {
      toast(`can't add recode column "${name}": ${reason}`, "danger");
      return null;
    }
    app.recordHistory("recode column");
    useApp.setState((s) => ({
      datasets: s.datasets.map((d) => {
        if (d.id !== datasetId) return d;
        const base = baseColumns(d.data, d.formulas?.length ?? 0);
        const formulas: ComputedColumn[] = [
          ...(d.formulas ?? []),
          { name, expr: `recode(${sourceLetter})`, deps: [sourceLetter], recode: { sourceLetter, mapping } },
        ];
        return { ...d, formulas, ...withRecomputedFormulas(base, formulas) };
      }),
    }));
    app.recordMacro(`Recode ${sourceLetter} → ${name}`, `qz.recode(${JSON.stringify(ds.name)}, ${JSON.stringify(sourceLetter)}, ${JSON.stringify(name)})`);
    app.touchDataset(datasetId);
    toast(`recoded "${ds.data.labels[resolvedChannel]}" → "${name}"`, "ok");
    set({ open: false, datasetId: null, channel: null, openLabel: null, openLetter: null, mapping: { groups: [] } });
    return target;
  },

  saveMapping: (name) => {
    const { datasetId, channel, mapping } = get();
    const ds = datasetId != null ? useApp.getState().datasets.find((d) => d.id === datasetId) : undefined;
    const levels = ds && channel != null ? categoricalLevels(ds.data, channel) : null;
    const nm = name.trim();
    if (!nm || !levels || mapping.groups.length === 0) return;
    const entry: SavedRecodeMapping = {
      id: nextSavedId(),
      name: nm,
      mapping,
      sourceLevels: [...levels],
      createdAt: new Date().toISOString(),
    };
    set((s) => ({ savedMappings: [...s.savedMappings, entry] }));
    toast(`saved recode mapping "${nm}"`, "ok");
  },
  deleteMapping: (id) => set((s) => ({ savedMappings: s.savedMappings.filter((m) => m.id !== id) })),
  applySavedMapping: (id) => {
    const saved = get().savedMappings.find((m) => m.id === id);
    const { datasetId, channel } = get();
    const ds = datasetId != null ? useApp.getState().datasets.find((d) => d.id === datasetId) : undefined;
    const levels = ds && channel != null ? categoricalLevels(ds.data, channel) : null;
    if (!saved || !levels) return;
    const resolution = resolveRecodeMapping(saved.mapping, levels);
    if (!resolution.ok) {
      toast(`can't apply "${saved.name}": ${resolution.reason}`, "danger");
      return;
    }
    set({ mapping: saved.mapping });
    toast(`applied recode mapping "${saved.name}"`, "ok");
  },
}));

/** Live preview for the currently-open panel (old -> new mapping table +
 *  resulting level count) — a thin wrapper so the view doesn't need to
 *  import `lib/recode.ts` AND read the store's dataset/channel by hand.
 *  DEFECT B miniature: resyncs `channel` against `openLabel` the same way
 *  `commitRecode` does (silently, since this is a read, not a mutation) so a
 *  mid-edit shift doesn't preview against the wrong column either; `null`
 *  when the identity can't be resolved at all (ambiguous/gone). */
export function activeRecodePreview() {
  const { datasetId, channel, openLabel, mapping } = useRecode.getState();
  const ds = datasetId != null ? useApp.getState().datasets.find((d) => d.id === datasetId) : undefined;
  const resolved = ds && channel != null && openLabel != null ? resolveRecodeChannel(ds.data.labels, channel, openLabel) : null;
  const levels = ds && resolved?.ok ? categoricalLevels(ds.data, resolved.channel) : null;
  if (!levels) return null;
  return buildRecodePreview(levels, mapping);
}
