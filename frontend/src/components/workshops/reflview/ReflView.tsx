// Reflectometry two-frame view (acceptance #11): top = measured + modelled
// reflectivity vs Q (log-Y by default), bottom = the SLD depth profile vs z. A
// refl1d export set (`*-refl.dat` + `*-profile.dat`) is two datasets; this pairs
// them (auto by filename stem) and shows both frames at once.

import { useReflView } from "./useReflView";
import ReflPanel from "./ReflPanel";
import { useApp } from "../../../store/useApp";
import ToolWindow from "../../overlays/ToolWindow";

export default function ReflView() {
  const close = useApp((s) => s.setReflViewOpen);
  const v = useReflView();

  return (
    <ToolWindow title="Reflectometry" x={130} y={70} width={480} onClose={() => close(false)}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="qzk-ds-meta">
          Data + model on top, SLD profile below. Pairs a refl1d <code>-refl.dat</code> with its{" "}
          <code>-profile.dat</code>.
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label className="qzk-field">
            <span>Reflectivity</span>
            <select
              className="qz-input"
              value={v.reflId ?? ""}
              onChange={(e) => v.setReflId(e.target.value)}
            >
              <option value="">— none —</option>
              {v.reflOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <label className="qzk-field">
            <span>SLD profile</span>
            <select
              className="qz-input"
              value={v.profileId ?? ""}
              onChange={(e) => v.setProfileId(e.target.value)}
            >
              <option value="">— none —</option>
              {v.profileOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <label className="qz-check" style={{ alignSelf: "flex-end" }}>
            <input type="checkbox" checked={v.logY} onChange={(e) => v.setLogY(e.target.checked)} />
            Log R
          </label>
        </div>

        {/* Top frame — reflectivity */}
        {v.panels.top ? (
          <ReflPanel payload={v.panels.top} yLog={v.logY} height={240} label="reflectivity" />
        ) : (
          <div className="qzk-ds-meta" style={{ height: 240, display: "grid", placeItems: "center" }}>
            Pick a reflectivity dataset (Q · R · theory)
          </div>
        )}

        {/* Bottom frame — SLD profile */}
        {v.panels.bottom ? (
          <ReflPanel payload={v.panels.bottom} yLog={false} height={200} label="sld-profile" />
        ) : (
          <div className="qzk-ds-meta" style={{ height: 200, display: "grid", placeItems: "center" }}>
            Pick an SLD profile dataset (z · rho)
          </div>
        )}
      </div>
    </ToolWindow>
  );
}
