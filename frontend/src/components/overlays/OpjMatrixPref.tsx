// Preferences ▸ Interaction row: File ▸ Export Origin project writes imported
// matrix books as Origin matrices (backend io/origin_project/writer_matrix.py)
// instead of X/Y/Z worksheet columns. Opt-in: the matrix window round-trips
// through this app's reader but has not been loaded in real Origin yet, and a
// window Origin rejects would refuse the whole project
// (docs/origin_project_format.md §8).

import { useApp } from "../../store/useApp";
import { Switch } from "../primitives/Switch";

export function OpjMatrixPref() {
  const on = useApp((s) => s.opjWriteMatrices);
  const setPref = useApp((s) => s.setPref);
  return (
    <div className="qzk-pref-row">
      <div className="qzk-pref-lbl">
        Write matrix books as Origin matrices
        <span className="hint">
          Origin project (.opj) export · not yet verified in Origin — off writes X/Y/Z worksheet columns
        </span>
      </div>
      <div className="qzk-pref-ctl">
        <Switch
          aria-label="Write matrix books as Origin matrices"
          checked={on}
          onChange={(v) => setPref("opjWriteMatrices", v)}
        />
      </div>
    </div>
  );
}
