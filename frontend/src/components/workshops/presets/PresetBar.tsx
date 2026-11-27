// The shared preset bar (plans/PRESET_BAR_CONTRACT.md section 6): pick a saved
// preset or "Last used", Apply it to the open panel's draft, Save as, Rename,
// Delete (confirmed) and a one-slot Revert. Generic over a `PresetAdapter`;
// a workshop mounts it through a lazy seam. Apply never runs the tool.

import { useState } from "react";

import { lazyRegion } from "../../../lib/lazyRegion";
import type { PresetAdapter } from "../../../lib/presetAdapter";
import { Button } from "../../primitives";
import { LAST_USED_ID, sourceText, usePresetBar, type PresetOptions } from "./usePresetBar";

const PresetManager = lazyRegion(() => import("./PresetManager"), "Manage presets");
const stamp = (iso: string): string => iso.slice(0, 16).replace("T", " ");
const row = { display: "flex", gap: 6, alignItems: "center", marginTop: 6, flexWrap: "wrap" } as const;

function NameRow({ initial, label, onSubmit, onCancel }: { initial: string; label: string; onSubmit: (name: string) => boolean | Promise<boolean>; onCancel: () => void }) {
  const [name, setName] = useState(initial);
  return (
    <div style={row}>
      <input
        className="qz-input"
        value={name}
        aria-label={label}
        placeholder="preset name"
        maxLength={64}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && name.trim()) void onSubmit(name);
          if (e.key === "Escape") onCancel();
        }}
      />
      <Button size="sm" disabled={!name.trim()} onClick={() => void onSubmit(name)}>Save</Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
    </div>
  );
}

export default function PresetBar<S extends object>({ adapter, ...opts }: { adapter: PresetAdapter<S> } & PresetOptions) {
  const bar = usePresetBar(adapter, opts);
  const [managing, setManaging] = useState(false);
  const [, refreshList] = useState(0); // an import changes the stored list: re-read it
  const { listing, last, entry } = bar;
  return (
    <section aria-label={`${adapter.label} presets`} style={{ marginBottom: 10, paddingBottom: 8, borderBottom: "1px solid var(--border)" }}>
      <label className="qzk-field-lbl">Presets</label>
      <div className="qzk-helptext" style={{ color: "var(--text-faint)" }}>{sourceText(bar.source, bar.edited)}</div>
      {listing.unreadable && <div className="qzk-helptext" role="alert" style={{ marginTop: 4, color: "var(--warn)" }}>{listing.unreadable}</div>}
      <div style={row}>
        <select className="qz-select" aria-label="Preset" value={bar.selected} onChange={(e) => bar.setSelected(e.target.value)}>
          <option value="">Choose a preset…</option>
          {last && (
            <option value={LAST_USED_ID} disabled={last.resolved.state !== "ok"} title={last.resolved.state === "ok" ? adapter.describe(last.resolved.settings) : last.resolved.reason}>
              {`Last used (${stamp(last.at)})${last.resolved.state === "ok" ? "" : ` — ${last.resolved.state}`}`}
            </option>
          )}
          {listing.entries.map((e) => (
            <option key={e.id} value={e.id} title={e.state === "ok" ? adapter.describe(e.settings) : e.reason}>
              {e.state === "ok" ? e.name : `${e.name} — ${e.state}: ${e.reason}`}
            </option>
          ))}
        </select>
        <Button size="sm" disabled={!bar.canApply} onClick={bar.apply} title={`Load the settings into this panel (then press ${adapter.runLabel})`}>Apply</Button>
        <Button size="sm" variant="ghost" disabled={!bar.canRevert} onClick={bar.revert} title="Put back the settings you had before applying">Revert</Button>
      </div>
      {entry && entry.state !== "ok" && <div className="qzk-helptext" style={{ marginTop: 4, color: "var(--text-faint)" }}>Cannot be applied: {entry.reason}.</div>}
      {bar.naming ? (
        <NameRow
          key={bar.naming}
          initial={bar.naming === "rename" ? (entry?.name ?? "") : ""}
          label={bar.naming === "rename" ? "New preset name" : "Preset name"}
          onSubmit={bar.submitName}
          onCancel={() => bar.setNaming(null)}
        />
      ) : (
        <div style={row}>
          <Button size="sm" onClick={() => bar.setNaming("save")} title="Save the settings now in this panel as a preset">Save as…</Button>
          <Button size="sm" variant="ghost" disabled={!bar.canEdit} onClick={() => bar.setNaming("rename")}>Rename…</Button>
          <Button size="sm" variant="ghost" disabled={!entry} onClick={() => void bar.remove()} title="Delete this saved preset">Delete…</Button>
          <Button size="sm" variant="ghost" onClick={() => setManaging((m) => !m)} title="Export presets to a file, or import a preset file">Manage presets…</Button>
        </div>
      )}
      {managing && <PresetManager workshop={adapter.workshop} label={adapter.label} onChanged={() => refreshList((n) => n + 1)} onClose={() => setManaging(false)} />}
      {bar.status && <div className="qzk-helptext" role="status" style={{ marginTop: 6, color: bar.status.bad ? "var(--danger)" : undefined }}>{bar.status.text}</div>}
    </section>
  );
}
