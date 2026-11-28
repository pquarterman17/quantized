// The preset bar's state (plans/PRESET_BAR_CONTRACT.md sections 4 and 5), over
// any `PresetAdapter`. Apply loads the open panel's draft and nothing else;
// a one-slot Revert returns to what the user had set by hand before the first
// Apply since the last run; last used is shown and applied only when asked
// (or when the opt-in preference starts tools from it).

import { useEffect, useRef, useState } from "react";

import { canonicalJson, type ApplyOutcome, type PresetAdapter } from "../../../lib/presetAdapter";
import { readLastUsed } from "../../../lib/presetLastUsed";
import { genericBackend, resolveSettings, type PresetEntry, type Resolved } from "../../../lib/presets";
import { workflowPrefsSlot } from "../../../lib/workflowPrefs";
import { askConfirm } from "../../../store/confirmDialog";
import { isLivePending, usePendingPreset } from "../../../store/pendingPreset";
import { useApp } from "../../../store/useApp";

export const LAST_USED_ID = "last-used";

export type PresetSource =
  | { kind: "defaults" }
  | { kind: "result" }
  | { kind: "preset"; name: string; settings: string; skip?: string[] }
  | { kind: "last-used"; settings: string; skip?: string[] }
  | { kind: "reverted" };

export interface PresetOptions {
  /** The panel started from a reopened result: it outranks a preset or last used. */
  fromResult: boolean;
  /** True while the tool is running: the Revert slot is cleared (a run ends the draft). */
  running: boolean;
}

export interface LastUsedView<S> {
  at: string;
  resolved: Resolved<S>;
}

/** Key-order independent text of a settings object (to tell "edited" from "as applied"). */
const canon = (o: object): string => canonicalJson(o);
/** `canon` without the fields an Apply could not carry over (the panel cannot hold them, so they never differ by an edit). */
const canonWithout = (o: object, skip: readonly string[]): string => canon(Object.fromEntries(Object.entries(o).filter(([k]) => !skip.includes(k))));

export function sourceText(s: PresetSource, edited: boolean): string {
  const base =
    s.kind === "defaults" ? "Defaults" : s.kind === "result" ? "the reopened result" : s.kind === "preset" ? `Preset '${s.name}'` : s.kind === "last-used" ? "Last used" : "Your own settings (reverted)";
  return `Settings: ${base}${edited ? " (edited)" : ""}`;
}

export function usePresetBar<S extends object>(adapter: PresetAdapter<S>, opts: PresetOptions) {
  const [, setVersion] = useState(0);
  const [selected, setSelected] = useState("");
  const [status, setStatus] = useState<{ text: string; bad: boolean } | null>(null);
  const [source, setSource] = useState<PresetSource>(opts.fromResult ? { kind: "result" } : { kind: "defaults" });
  const [snapshot, setSnapshot] = useState<S | null>(null);
  // What the panel held when it opened (or after a Revert): "edited" for a source that carries no
  // settings of its own (defaults, a reopened result, a revert) means "differs from this".
  const [baseline, setBaseline] = useState(() => canon(adapter.capture()));
  const [naming, setNaming] = useState<"save" | "rename" | null>(null);
  const setAppStatus = useApp((s) => s.setStatus);

  const backend = adapter.backend ?? genericBackend(adapter);
  const listing = backend.list();
  const lastRaw = readLastUsed(adapter.workshop);
  const last: LastUsedView<S> | null = lastRaw ? { at: lastRaw.at, resolved: resolveSettings(adapter, lastRaw.schema, lastRaw.settings) } : null;
  const entry: PresetEntry<S> | undefined = listing.entries.find((e) => e.id === selected);
  const chosenSettings = selected === LAST_USED_ID ? (last?.resolved.state === "ok" ? last.resolved.settings : null) : entry?.state === "ok" ? entry.settings : null;

  const say = (text: string, bad = false) => {
    setStatus({ text, bad });
    setAppStatus(text); // the app's status line, not only this bar
  };
  const refresh = () => setVersion((v) => v + 1);

  /** Load `settings` into the panel; the first Apply since the last run keeps the hand-set state for Revert. */
  function load(settings: S, label: string, dropped: string[], src: PresetSource): ApplyOutcome {
    const before = snapshot ?? adapter.capture();
    const out = adapter.apply(settings);
    if (!out.ok) {
      say(`Could not apply ${label}: ${out.reason}`, true);
      return out;
    }
    if (!snapshot) setSnapshot(before);
    setSource(src.kind === "preset" || src.kind === "last-used" ? { ...src, skip: out.skipped.map((s) => s.field) } : src);
    const next = adapter.recomputes ? `the result updates on its own; press ${adapter.runLabel} to keep it` : `press ${adapter.runLabel} to run it`;
    const parts = [`Applied ${label} to ${adapter.label}: ${next}`];
    for (const s of out.skipped) parts.push(`${adapter.fieldNames?.[s.field] ?? s.field} skipped (${s.reason})`);
    for (const d of dropped) parts.push(`setting '${d}' is no longer supported and was not applied`);
    parts.push(...out.notes);
    say(parts.join("; "));
    return out;
  }

  // Order of authority on open: a reopened result, then (opt-in) last used, then defaults.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (isLivePending(usePendingPreset.getState().pending, adapter.workshop)) return; // an explicit "Open in tool" outranks last used
    if (opts.fromResult || !workflowPrefsSlot.load().startFromLastUsed || last?.resolved.state !== "ok") return;
    load(last.resolved.settings, "last-used settings", last.resolved.dropped, { kind: "last-used", settings: canon(last.resolved.settings) });
    setSelected(LAST_USED_ID);
    // Runs once on open, reading the values at that moment: later changes to
    // the result, last used or `load` must not re-apply it (P3). The `started`
    // ref also absorbs React's dev double-mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once on open, by design
  }, []);
  // "Open in tool" from the Recipe Library: load that preset's draft (P8: never runs), unless a reopened result outranks it.
  const handoff = usePendingPreset((s) => s.pending);
  useEffect(() => {
    if (!isLivePending(handoff, adapter.workshop)) return;
    usePendingPreset.getState().clear();
    if (opts.fromResult) return say("The reopened result's settings were kept; the preset from the Library was not applied");
    const e = listing.entries.find((x) => x.id === handoff.id);
    if (!e) return say("That preset no longer exists", true);
    if (e.state !== "ok") return say(`Cannot apply preset '${e.name}': ${e.reason}`, true);
    load(e.settings, `preset '${e.name}'`, e.dropped, { kind: "preset", name: e.name, settings: canon(e.settings) });
    setSelected(e.id);
    // Runs when a handoff arrives; `listing` and `load` are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per handoff, by design
  }, [handoff]);
  useEffect(() => {
    if (opts.running) setSnapshot(null);
  }, [opts.running]);

  function apply(): void {
    if (selected === LAST_USED_ID && last?.resolved.state === "ok") {
      load(last.resolved.settings, "last-used settings", last.resolved.dropped, { kind: "last-used", settings: canon(last.resolved.settings) });
    } else if (entry?.state === "ok") {
      load(entry.settings, `preset '${entry.name}'`, entry.dropped, { kind: "preset", name: entry.name, settings: canon(entry.settings) });
    }
  }

  function revert(): void {
    if (!snapshot) return;
    const out = adapter.apply(snapshot);
    setSnapshot(null);
    setBaseline(canon(snapshot));
    setSource({ kind: "reverted" });
    say(out.ok ? "Reverted to the settings you had before applying" : `Could not revert: ${out.reason}`, !out.ok);
  }

  async function submitName(name: string): Promise<boolean> {
    if (naming === "save") {
      const same = backend.sameName ?? ((a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase());
      const clash = listing.entries.find((e) => same(e.name, name));
      if (clash && clash.state === "locked") {
        say(`'${clash.name}' is locked (${clash.reason}) and is never replaced; choose another name`, true);
        return false;
      }
      if (clash && !(await askConfirm(`Replace the ${adapter.label} preset "${clash.name}"?`, "A preset with this name already exists; its saved settings are overwritten.", "Replace", true))) return false;
    }
    const captured = adapter.capture();
    const out = naming === "rename" && entry ? backend.rename(entry.id, name) : backend.save(name, captured);
    refresh();
    if (!out.ok) {
      say(out.reason, true);
      return false;
    }
    setSelected(out.id);
    setNaming(null);
    // The bar now names what is in the panel: the preset just saved (or renamed).
    if (naming === "save") setSource({ kind: "preset", name: name.trim(), settings: canon(captured), skip: [] });
    else if (source.kind === "preset" && entry?.name === source.name) setSource({ ...source, name: name.trim() });
    say(naming === "rename" ? `Renamed to '${name.trim()}'` : `${out.updated ? "Updated" : "Saved"} preset '${name.trim()}'`);
    return true;
  }

  async function remove(): Promise<void> {
    if (!entry) return;
    const ok = await askConfirm(
      `Delete the ${adapter.label} preset "${entry.name}"?`,
      "It is removed from this computer. Results already created with it are not changed.",
      "Delete preset",
      true,
    );
    if (!ok) return;
    const out = backend.remove(entry.id);
    refresh();
    if (out.ok) setSelected("");
    say(out.ok ? `Deleted preset '${entry.name}'` : out.reason, !out.ok);
  }

  const applied = source.kind === "preset" || source.kind === "last-used" ? source.settings : null;
  const skip = source.kind === "preset" || source.kind === "last-used" ? (source.skip ?? []) : [];
  const edited = applied !== null ? canonWithout(adapter.capture(), skip) !== canonWithout(JSON.parse(applied) as object, skip) : canon(adapter.capture()) !== baseline;
  return {
    listing, last, entry, selected, setSelected, status, source, edited, naming, setNaming,
    canApply: chosenSettings !== null, canRevert: snapshot !== null, canEdit: entry?.state === "ok" || entry?.state === "rejected",
    apply, revert, submitName, remove,
  };
}
