// Explicitly saved, named sample profiles (MAIN_PLAN #42). Save needs a typed
// name; Load only fills the form (never applies, never picks a basis);
// Delete removes one saved profile. All three are single undoable steps.

import { useState } from "react";

import { Button, Select } from "../../primitives";
import type { SavedSampleProfile } from "../../../lib/sampleGeometry";

export function SavedProfilesRow(props: {
  saved: SavedSampleProfile[];
  onSave: (name: string) => void;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { saved } = props;
  const [name, setName] = useState("");
  const [picked, setPicked] = useState("");
  const selected = saved.some((p) => p.id === picked) ? picked : (saved[0]?.id ?? "");
  return (
    <fieldset className="qz-mag-profiles">
      <legend className="qzk-field-lbl">Saved sample profiles</legend>
      <div className="qz-mag-profile-row">
        <input
          className="qz-input"
          aria-label="Profile name"
          placeholder="Profile name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button size="sm" onClick={() => { props.onSave(name); setName(""); }}>Save profile</Button>
      </div>
      {saved.length === 0 ? (
        <div className="qzk-ds-meta qz-mag-muted">No saved profiles yet. A saved profile is only ever applied when you load it here.</div>
      ) : (
        <div className="qz-mag-profile-row">
          <Select
            aria-label="Saved sample profile"
            options={saved.map((p) => ({ value: p.id, label: p.name }))}
            value={selected}
            onChange={(e) => setPicked(e.target.value)}
          />
          <Button size="sm" onClick={() => props.onLoad(selected)}>Load into form</Button>
          <Button size="sm" onClick={() => props.onDelete(selected)}>Delete profile</Button>
        </div>
      )}
    </fieldset>
  );
}
