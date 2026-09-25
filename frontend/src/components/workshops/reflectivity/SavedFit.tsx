// Reflectivity fit — the saved-fit block (P2.2 slice 3): the history picker
// over the bound dataset's stored fits, and, when the picked fit is not the
// live one, its saved result with the three things a saved fit offers. Thin:
// the state is useReflFitHistory's.

import { Button, Select } from "../../primitives";
import FitResults from "./FitResults";
import { decimationNote } from "./reflFitCurves";
import { formatNum } from "./reflFitModel";
import ReflUncertainty from "./ReflUncertainty";
import type { ReflFitRecord } from "./reflFitRecord";
import type { ReflFitState } from "./useReflFit";

const MONO = { fontFamily: "var(--font-mono)" } as const;
const NOTE = { marginTop: 6 } as const;

function when(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString() : "unknown time";
}

function optionLabel(r: ReflFitRecord): string {
  const o = r.result.objective;
  return `#${r.seq} · ${when(r.fittedAt)} · ${o.label} ${formatNum(o.value)}`;
}

/** The picker: every saved fit of the bound dataset, newest first. */
export function FitHistoryPicker({ fit, showingLive }: { fit: ReflFitState; showingLive: boolean }) {
  const h = fit.history;
  if (h.records.length === 0) return null;
  const liveId = fit.liveRecord?.id;
  const current = showingLive && h.records.some((r) => r.id === liveId) ? (liveId as string) : (h.selected?.id ?? "");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
      <span className="qzk-field-lbl" style={{ margin: 0 }}>
        History
      </span>
      <Select
        aria-label="saved fits"
        options={h.records.map((r) => ({ value: r.id, label: optionLabel(r) }))}
        value={current}
        onChange={(e) => h.pick(e.target.value)}
      />
      <span className="qzk-ds-meta" style={{ ...MONO, color: "var(--text-faint)" }}>
        {h.records.length}
      </span>
    </div>
  );
}

/** A saved fit's result and actions (shown when the pick is not the live fit). */
export default function SavedFit({ fit }: { fit: ReflFitState }) {
  const h = fit.history;
  const r = h.selected;
  if (!r) return null;
  const { missing, changed } = h.issues;
  return (
    <div aria-label="saved fit">
      <div className="qzk-ds-meta" style={{ marginTop: 10, marginBottom: 6 }}>
        Saved fit <span style={MONO}>#{r.seq}</span> — {when(r.fittedAt)}, {r.request.channels.length}{" "}
        {r.request.channels.length === 1 ? "channel" : "channels"}, {r.model.radiation === "xray" ? "X-ray" : "neutron"}
      </div>
      {missing.length > 0 && (
        <ul className="qzk-ds-meta qzk-msg" role="alert" style={{ margin: "0 0 6px", paddingLeft: 16, color: "var(--danger)" }}>
          {missing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      {changed.length > 0 && (
        <ul className="qzk-ds-meta qzk-msg" role="note" style={{ margin: "0 0 6px", paddingLeft: 16, color: "var(--warn)" }}>
          {changed.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      <FitResults result={r.result} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        <Button size="sm" disabled={h.applyBlocked != null} title={h.applyBlocked ?? undefined} onClick={h.applySaved}>
          Apply to model
        </Button>
        <Button size="sm" onClick={h.restore}>
          Restore fit setup
        </Button>
        <Button size="sm" disabled={h.reporting} onClick={() => void h.addToReport(r)}>
          Add to report
        </Button>
        <Button size="sm" disabled={!r.curves} onClick={h.showOverlay}>
          Overlay on data
        </Button>
        <Button size="sm" disabled={!r.curves || h.savedCurvesAdded} onClick={() => void h.addSavedCurves()}>
          {h.savedCurvesAdded ? "Fit curves added" : "Add fit curves"}
        </Button>
      </div>
      {h.applyBlocked && (
        <div className="qzk-ds-meta qzk-msg" role="note" style={{ ...NOTE, color: "var(--warn)" }}>
          Apply is unavailable: {h.applyBlocked}. Restore fit setup loads the layer model this fit ran on.
        </div>
      )}
      <div className="qzk-ds-meta" style={{ ...NOTE, color: "var(--text-faint)" }}>
        {r.curves
          ? (decimationNote(r.curves) ?? "The fit's curves are stored with it.")
          : "Fit curves were not stored with this fit — re-run to plot: restore its setup and run it again."}
      </div>
      <ReflUncertainty dream={fit.dream} record={r} />
    </div>
  );
}
