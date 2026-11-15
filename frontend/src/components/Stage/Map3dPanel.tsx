// The Map toolbar's 3-D view panel (lazy chunk): choose Surface / 3-D scatter /
// 3-D waterfall for this map, its elevation and azimuth as numbers, the z-axis
// label and unit, the figure style and title. Every committed edit is ONE
// undoable `setMapView3d` write to the durable per-dataset map view, so it is
// saved with the `.dwk` and the figure state; the preview (`Map3dPreview`) and
// ⤓ read the same record. The colormap is the toolbar's own "map" picker (a
// waterfall steps its curves through it).
//
// Numbers commit on blur / Enter, not per keystroke (one gesture, one undo
// step); an out-of-range angle is refused with the reason and not stored.

import { useState } from "react";

import { DEFAULT_MAP3D, MAP3D_KINDS, type Map3dView } from "../../lib/mapView3d";
import { mapViewFor } from "../../lib/mapView";
import { useApp } from "../../store/useApp";
import { FIGURE_STYLES } from "../workshops/figurebuilder/figureOutputConstants";
import AngleField from "./AngleField";
import { FLAT_CHOICE, MAP3D_LABELS, WATERFALL_MAX_LINES } from "./map3dRequest";

const ROW = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 11 } as const;

function TextField({ label, value, onCommit, width }: { label: string; value: string; onCommit: (v: string) => void; width: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null) onCommit(draft.trim());
    setDraft(null);
  };
  return (
    <label style={ROW}>
      {label}
      <input
        type="text"
        aria-label={label}
        maxLength={80}
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setDraft(null);
        }}
        style={{ width }}
      />
    </label>
  );
}

export default function Map3dPanel({ datasetId, onClose }: { datasetId: string | null; onClose: () => void }) {
  const view3d = useApp((s) => mapViewFor(s.mapViews, datasetId).view3d);
  const set = useApp((s) => s.setMapView3d);
  const edit = (patch: Partial<Map3dView>) => set(datasetId, { ...(view3d ?? DEFAULT_MAP3D), ...patch });
  return (
    <div
      role="group"
      aria-label="3-D view"
      className="qzk-glass"
      style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 5, display: "grid", gap: 6, padding: 10, width: 250 }}
      onKeyDown={(e) => e.key === "Escape" && (e.target as HTMLElement).tagName !== "INPUT" && onClose()}
    >
      <label style={ROW}>
        View
        <select
          aria-label="3-D view kind"
          value={view3d ? MAP3D_LABELS[view3d.kind] : FLAT_CHOICE}
          onChange={(e) => {
            const kind = MAP3D_KINDS.find((k) => MAP3D_LABELS[k] === e.target.value);
            if (kind) edit({ kind });
            else set(datasetId, undefined);
          }}
        >
          {[FLAT_CHOICE, ...Object.values(MAP3D_LABELS)].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </label>
      {view3d ? (
        <>
          <AngleField label="Elevation (°)" value={view3d.elev} lim={90} onCommit={(elev) => edit({ elev })} />
          <AngleField label="Azimuth (°)" value={view3d.azim} lim={360} onCommit={(azim) => edit({ azim })} />
          <TextField label="Z label" value={view3d.zLabel} width={110} onCommit={(zLabel) => edit({ zLabel })} />
          <TextField label="Z unit" value={view3d.zUnit} width={110} onCommit={(zUnit) => edit({ zUnit })} />
          <label style={ROW}>
            Style
            <select aria-label="3-D figure style" value={view3d.style} onChange={(e) => edit({ style: e.target.value })}>
              {FIGURE_STYLES.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <TextField label="Title" value={view3d.title} width={140} onCommit={(title) => edit({ title })} />
          <div style={{ fontSize: 11, color: "var(--text-dim)", whiteSpace: "normal", lineHeight: 1.4 }}>
            A static render; ⤓ exports exactly this view. Colormap is the toolbar's “map”. Needs a grid of at least 2×2
            {view3d.kind === "waterfall" ? ` and two or more rows; at most ${WATERFALL_MAX_LINES} evenly stepped rows are drawn (the preview says how many)` : ""}
            {view3d.kind === "scatter3d" ? "; scattered data plots your original points, not the regridded surface" : ""}.
          </div>
        </>
      ) : (
        <div style={{ fontSize: 11, color: "var(--text-dim)", whiteSpace: "normal", lineHeight: 1.4 }}>
          Pick Surface, 3-D scatter or 3-D waterfall to view this map in 3-D.
        </div>
      )}
    </div>
  );
}
