// Fit Model > Save columns (JMP Save Columns): writes the predicted values, and
// optionally residuals and confidence-interval columns, as a new output
// worksheet beside the source (lib/fitModelColumns, store/fitModelColumns). The
// worksheet's X is the source row number; the prediction formula's text rides in
// its metadata (provisional: values + formula text, not a live formula column).

import { useState } from "react";

import { DEFAULT_SAVE_COLUMNS, type SaveColumnOptions } from "../../../lib/fitModelColumns";
import { Button } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import type { FitModelState } from "./useFitModel";

export default function SaveColumnsSection({ m }: { m: FitModelState }) {
  const [opts, setOpts] = useState<SaveColumnOptions>(DEFAULT_SAVE_COLUMNS);
  const [saved, setSaved] = useState(false);
  const set = (patch: Partial<SaveColumnOptions>) => { setOpts((o) => ({ ...o, ...patch })); setSaved(false); };
  return (
    <div>
      <p className="qz-result-book-note">
        Adds a worksheet with the predicted values (and the options below), one row per fitted row, keyed by the
        worksheet row number. The prediction formula is stored in its metadata as text.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Checkbox checked disabled>Predicted values</Checkbox>
        <Checkbox checked={opts.residual} onChange={(residual) => set({ residual })}>Residuals</Checkbox>
        <Checkbox checked={opts.meanInterval} onChange={(meanInterval) => set({ meanInterval })}>
          Mean confidence interval (of the fitted mean)
        </Checkbox>
        <Checkbox checked={opts.individualInterval} onChange={(individualInterval) => set({ individualInterval })}>
          Individual confidence interval (prediction interval)
        </Checkbox>
      </div>
      <div style={{ marginTop: 6 }}>
        <Button size="sm" disabled={m.busy} onClick={() => setSaved(m.saveColumns(opts) !== null)}>Save as worksheet</Button>
        {saved && <span className="qzk-ds-meta" role="status" style={{ marginLeft: 8, color: "var(--text-faint)" }}>Saved as a new worksheet.</span>}
      </div>
    </div>
  );
}
